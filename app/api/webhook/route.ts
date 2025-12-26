import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { createHash, randomUUID } from 'crypto';
import { normalizeWebhookPayload, processDVUWebhook } from '@/lib/dvu/engine';
import type { DVUWebhookPayload } from '@/lib/dvu/types';

export const dynamic = 'force-dynamic';

function kvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

type AdminWebhookRecord = {
  id: string;
  receivedAt: string;
  processed: boolean;
  source: 'SCANNER' | 'DVU_FULL';
  ticker: string;
  direction: string;
  quality: string;
  confluenceScore?: number;
  rawPayload: unknown;
};

type AdminDecisionRecord = {
  id: string;
  createdAt: string;
  webhookId: string;
  action: 'EXECUTE' | 'PAPER' | 'SKIP';
  instrument: string;
  reason: string;
  finalConfidence?: number;
  enrichmentData?: unknown;
  outcome?: 'WIN' | 'LOSS' | 'MISSED_WIN' | 'AVOIDED_LOSS';
  outcomeNotes?: string;
};

type AdminOrderRecord = {
  id: string;
  createdAt: string;
  decisionId: string;
  brokerOrderId?: string;
  symbol: string;
  optionSymbol?: string;
  side: string;
  quantity: number;
  filledPrice?: number;
  status: string;
};

type AdminPositionRecord = {
  id: string;
  openedAt: string;
  closedAt?: string;
  entryOrderId?: string;
  entryDecisionId: string;
  entryWebhookId: string;
  symbol: string;
  direction: string;
  quantity: number;
  entryPrice: number;
  currentPrice?: number;
  stopLoss?: number;
  target1?: number;
  unrealizedPnl?: number;
  realizedPnl?: number;
  status: 'OPEN' | 'CLOSED' | string;
  exitPrice?: number;
  exitReason?: string;
  notes?: string;
  tags?: string[];
};

function nowIso() {
  return new Date().toISOString();
}

function isoToScoreMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function adminRetentionSeconds(): number {
  // With ~150-400 webhooks/day, 30 days is typically plenty for analysis and keeps KV costs predictable.
  const days = clampInt(intEnv('ADMIN_KV_RETENTION_DAYS', 30), 1, 365);
  return days * 86400;
}

function adminIndexMax(): number {
  // Max size for sorted-set indexes (keeps list views fast). At 400/day, 50k ≈ 125 days.
  return clampInt(intEnv('ADMIN_KV_INDEX_MAX', 50_000), 1_000, 500_000);
}

function adminActivityMax(): number {
  return clampInt(intEnv('ADMIN_KV_ACTIVITY_MAX', 500), 100, 5_000);
}

function webhookAuthed(request: Request): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true; // disabled unless configured
  const headerSecret = request.headers.get('x-webhook-secret') || request.headers.get('x-webhook-token');
  // Legacy support: allow ?token= for older TradingView alert setups.
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  return headerSecret === secret || token === secret;
}

function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function secondsUntilNextUtcDay(now = new Date()): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  const diffMs = next.getTime() - now.getTime();
  return Math.max(60, Math.ceil(diffMs / 1000));
}

function payloadHash(payload: unknown): string {
  // Best-effort stable hash for idempotency. For TradingView retries the JSON shape/order is consistent.
  const raw = JSON.stringify(payload);
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    kvConfigured: kvConfigured(),
    minConfluenceScanner: Number(process.env.MIN_CONFLUENCE_SCANNER ?? 2),
    minConfluenceFull: Number(process.env.MIN_CONFLUENCE_FULL ?? 5),
    enableAutoTrading: String(process.env.ENABLE_AUTO_TRADING ?? 'false'),
    signalMaxAgeMs: Number(process.env.SIGNAL_MAX_AGE_MS ?? 2 * 60 * 1000),
    dailyTradeLimit: Number(process.env.DAILY_TRADE_LIMIT ?? 10),
    minBuyingPower: Number(process.env.MIN_BUYING_POWER ?? 1000),
  });
}

export async function POST(request: Request) {
  try {
    if (!webhookAuthed(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = (await request.json()) as DVUWebhookPayload;
    const normalized = normalizeWebhookPayload(data);

    const kvOk = kvConfigured();
    const adminKvEnabled = kvOk;
    const adminWebhookId = `wh_${randomUUID()}`;
    const receivedAt = nowIso();
    const adminTtlSec = adminRetentionSeconds();
    const idxMax = adminIndexMax();
    const activityMax = adminActivityMax();

    // Webhook idempotency (KV-backed). Prevents retries/bursts from double-executing.
    // Enabled by default when KV is configured; can be disabled via WEBHOOK_DEDUPE_ENABLED=false.
    const dedupeEnabled = kvOk && boolEnv('WEBHOOK_DEDUPE_ENABLED', true);
    const dedupeTtlSec = clampInt(intEnv('WEBHOOK_DEDUPE_TTL_SEC', 86400), 60, 7 * 86400);
    const dedupeKey = dedupeEnabled
      ? `dedupe:webhook:${normalized.source}:${normalized.ticker}:${normalized.direction}:${normalized.timestamp}:${payloadHash(data)}`
      : '';
    let dedupeExistingWebhookId: string | null = null;
    if (dedupeEnabled) {
      const res = await kv.set(dedupeKey, adminWebhookId, { nx: true, ex: dedupeTtlSec });
      if (res === null) {
        dedupeExistingWebhookId = (await kv.get<string>(dedupeKey)) ?? null;
      }
    }

    // Admin KV: store every inbound webhook (even stale / invalid), plus a time index for listing.
    if (adminKvEnabled) {
      const wh: AdminWebhookRecord = {
        id: adminWebhookId,
        receivedAt,
        processed: false,
        source: normalized.source === 'scanner' ? 'SCANNER' : 'DVU_FULL',
        ticker: normalized.ticker,
        direction: String(normalized.direction ?? ''),
        quality: (normalized.qualityLabel ?? 'UNKNOWN').slice(0, 20),
        confluenceScore: Number.isFinite(normalized.confluenceScore as any) ? Number(normalized.confluenceScore) : undefined,
        rawPayload: data,
      };

      const whKey = `admin:webhooks:${adminWebhookId}`;
      const whTickerKey = `admin:webhooks:by_ticker:${normalized.ticker}`;

      await Promise.all([
        kv.set(whKey, wh),
        kv.expire(whKey, adminTtlSec),
        kv.zadd('admin:webhooks:by_received_at', { score: isoToScoreMs(receivedAt), member: adminWebhookId }),
        kv.zremrangebyrank('admin:webhooks:by_received_at', 0, -idxMax - 1),
        kv.sadd(whTickerKey, adminWebhookId),
        kv.expire(whTickerKey, adminTtlSec),
        kv.lpush(
          'admin:activity',
          JSON.stringify({
            ts: receivedAt,
            type: 'webhook_received',
            webhookId: adminWebhookId,
            ticker: normalized.ticker,
            direction: normalized.direction,
            source: normalized.source === 'scanner' ? 'SCANNER' : 'DVU_FULL',
          })
        ),
        kv.ltrim('admin:activity', 0, activityMax - 1),
      ]);
    }

    // Duplicate webhook short-circuit (but still shows in admin audit trail).
    if (dedupeEnabled && dedupeExistingWebhookId) {
      if (adminKvEnabled) {
        const decisionId = `dc_${randomUUID()}`;
        const createdAt = nowIso();
        const dec: AdminDecisionRecord = {
          id: decisionId,
          createdAt,
          webhookId: adminWebhookId,
          action: 'SKIP',
          instrument: 'N/A',
          reason: `Duplicate webhook (deduped). Original: ${dedupeExistingWebhookId}`,
          enrichmentData: { normalized, dedupeKey, dedupeTtlSec, originalWebhookId: dedupeExistingWebhookId },
        };

        const decKey = `admin:decisions:${decisionId}`;
        const decTickerKey = `admin:decisions:by_ticker:${normalized.ticker}`;
        const whDecisionKey = `admin:webhooks:${adminWebhookId}:decision_id`;

        await Promise.all([
          kv.set(decKey, dec),
          kv.expire(decKey, adminTtlSec),
          kv.set(whDecisionKey, decisionId),
          kv.expire(whDecisionKey, adminTtlSec),
          kv.zadd('admin:decisions:by_created_at', { score: isoToScoreMs(createdAt), member: decisionId }),
          kv.zremrangebyrank('admin:decisions:by_created_at', 0, -idxMax - 1),
          kv.sadd(decTickerKey, decisionId),
          kv.expire(decTickerKey, adminTtlSec),
          kv.lpush(
            'admin:activity',
            JSON.stringify({
              ts: createdAt,
              type: 'webhook_duplicate',
              webhookId: adminWebhookId,
              originalWebhookId: dedupeExistingWebhookId,
              dedupeKey,
              ticker: normalized.ticker,
            })
          ),
          kv.ltrim('admin:activity', 0, activityMax - 1),
        ]);

        const wh = (await kv.get<AdminWebhookRecord>(`admin:webhooks:${adminWebhookId}`)) ?? null;
        if (wh) {
          wh.processed = true;
          await kv.set(`admin:webhooks:${adminWebhookId}`, wh);
        }
      }

      return NextResponse.json({
        status: 'duplicate',
        kvConfigured: kvOk,
        adminKv: adminKvEnabled ? { enabled: true, webhookId: adminWebhookId } : { enabled: false },
        dedupe: { enabled: true, dedupeKey, originalWebhookId: dedupeExistingWebhookId, ttlSeconds: dedupeTtlSec },
      });
    }

    // Reject stale signals (> 2 minutes by default).
    const maxAgeMs = Number(process.env.SIGNAL_MAX_AGE_MS ?? 2 * 60 * 1000);
    if (!Number.isFinite(normalized.timestamp) || Date.now() - normalized.timestamp > maxAgeMs) {
      // Admin KV: create a SKIP decision so stale rejections show in audit history
      if (adminKvEnabled) {
        const decisionId = `dc_${randomUUID()}`;
        const createdAt = nowIso();
        const dec: AdminDecisionRecord = {
          id: decisionId,
          createdAt,
          webhookId: adminWebhookId,
          action: 'SKIP',
          instrument: 'N/A',
          reason: 'Stale signal (timestamp outside SIGNAL_MAX_AGE_MS window)',
          enrichmentData: { normalized, maxAgeMs },
        };

        const decKey = `admin:decisions:${decisionId}`;
        const decTickerKey = `admin:decisions:by_ticker:${normalized.ticker}`;
        const whDecisionKey = `admin:webhooks:${adminWebhookId}:decision_id`;

        await Promise.all([
          kv.set(decKey, dec),
          kv.expire(decKey, adminTtlSec),
          kv.set(whDecisionKey, decisionId),
          kv.expire(whDecisionKey, adminTtlSec),
          kv.zadd('admin:decisions:by_created_at', { score: isoToScoreMs(createdAt), member: decisionId }),
          kv.zremrangebyrank('admin:decisions:by_created_at', 0, -idxMax - 1),
          kv.sadd(decTickerKey, decisionId),
          kv.expire(decTickerKey, adminTtlSec),
          kv.lpush(
            'admin:activity',
            JSON.stringify({
              ts: createdAt,
              type: 'decision_made',
              webhookId: adminWebhookId,
              decisionId,
              action: dec.action,
              ticker: normalized.ticker,
            })
          ),
          kv.ltrim('admin:activity', 0, activityMax - 1),
        ]);

        const wh = (await kv.get<AdminWebhookRecord>(`admin:webhooks:${adminWebhookId}`)) ?? null;
        if (wh) {
          wh.processed = true;
          await kv.set(`admin:webhooks:${adminWebhookId}`, wh);
        }
      }
      return NextResponse.json({ error: 'Stale signal', timestamp: normalized.timestamp }, { status: 400 });
    }

    // Daily trade count (KV-backed when configured)
    const dailyKey = `metrics:daily_trades:${utcDayKey()}`;
    const dailyTradeCount = kvOk ? Number((await kv.get(dailyKey)) ?? 0) : 0;

    const result = await processDVUWebhook(data, { dailyTradeCount });

    const status = !result.validation.isValid
      ? 'rejected'
      : result.decision.disposition === 'SKIP'
        ? 'skipped'
        : result.decision.disposition === 'PAPER'
          ? 'paper'
          : result.execution?.executed
            ? 'executed'
            : result.shouldExecute
              ? 'execute_failed'
              : 'approved';

    // Still return a decision even if KV isn't configured (useful for local testing).
    if (!kvOk) {
      return NextResponse.json({
        status,
        kvConfigured: false,
        adminKvEnabled: false,
        signal: result.signal,
        validation: result.validation,
        scores: result.scores,
        decision: result.decision,
        enrichment: result.enrichment,
        execution: result.execution,
      });
    }

    const isoTs = new Date(result.signal.timestamp).toISOString();
    const id = `signals:${isoTs}:${result.signal.ticker}:${randomUUID()}`;

    const record = {
      id,
      receivedAt: new Date().toISOString(),
      // Flatten key fields used by the dashboard components:
      ticker: result.signal.ticker,
      timeframe_minutes: result.signal.timeframeMinutes,
      timestamp: isoTs,
      type: result.signal.source === 'full' ? (result.signal.qualityLabel ?? 'DVU_FULL') : (result.signal.qualityLabel ?? 'DVU_SCANNER'),
      direction: result.signal.direction,
      quality: result.scores.originalScore,
      quality_stars: (result.signal.raw as any)?.signal?.quality_stars,
      entry: result.decision.entryPrice,
      pattern: (result.signal.raw as any)?.strat?.patterns?.detected_name,
      decision: status,
      reason: result.validation.isValid ? result.decision.reasoning.join(' | ') : `Failed: ${result.validation.failedChecks.join(', ')}`,
      // Back-compat: older UI expects shares; for options this is contracts.
      shares: result.decision.quantity,
      quantity: result.decision.quantity,
      action: result.decision.action,
      instrumentType: result.decision.instrumentType,
      confidence: result.decision.confidence,
      optionStructure: result.decision.optionStructure,
      option: result.decision.optionContract
        ? {
            symbol: result.decision.optionContract.symbol,
            underlying: result.decision.optionContract.underlying,
            type: result.decision.optionContract.type,
            expiration: result.decision.optionContract.expiration,
            strike: result.decision.optionContract.strike,
            bid: result.decision.optionContract.bid,
            ask: result.decision.optionContract.ask,
            last: result.decision.optionContract.last,
            volume: result.decision.optionContract.volume,
            openInterest: result.decision.optionContract.openInterest,
            greeks: result.decision.optionContract.greeks,
          }
        : undefined,
      spread: result.decision.optionSpread
        ? {
            structure: result.decision.optionSpread.structure,
            expiration: result.decision.optionSpread.expiration,
            width: result.decision.optionSpread.width,
            estimatedDebit: result.decision.optionSpread.estimatedDebit,
            estimatedCredit: result.decision.optionSpread.estimatedCredit,
            estimatedMaxLoss: result.decision.optionSpread.estimatedMaxLoss,
            estimatedMaxProfit: result.decision.optionSpread.estimatedMaxProfit,
            longLeg: result.decision.optionSpread.longLeg,
            shortLeg: result.decision.optionSpread.shortLeg,
          }
        : undefined,
      legs: result.decision.optionLegs,
      // Full payloads for debugging/iteration:
      webhook: data,
      evaluated: result,
    };

    // Admin KV: decision/order/position chain
    if (adminKvEnabled) {
      const decisionId = `dc_${randomUUID()}`;
      const createdAt = nowIso();
      const decisionReason = result.validation.isValid
        ? result.decision.reasoning.join(' | ')
        : `Failed: ${result.validation.failedChecks.join(', ')}`;

      const dec: AdminDecisionRecord = {
        id: decisionId,
        createdAt,
        webhookId: adminWebhookId,
        action: result.decision.disposition,
        instrument: result.decision.instrumentType,
        reason: decisionReason,
        finalConfidence: Number.isFinite(result.decision.confidence as any) ? Number(result.decision.confidence.toFixed(2)) : undefined,
        enrichmentData: {
          signal: result.signal,
          validation: result.validation,
          scores: result.scores,
          decision: result.decision,
          enrichment: result.enrichment,
          execution: result.execution,
        },
      };

      const ops: Promise<any>[] = [];
      const decKey = `admin:decisions:${decisionId}`;
      const decTickerKey = `admin:decisions:by_ticker:${result.signal.ticker}`;
      const whDecisionKey = `admin:webhooks:${adminWebhookId}:decision_id`;

      ops.push(kv.set(decKey, dec));
      ops.push(kv.expire(decKey, adminTtlSec));
      ops.push(kv.set(whDecisionKey, decisionId));
      ops.push(kv.expire(whDecisionKey, adminTtlSec));
      ops.push(kv.zadd('admin:decisions:by_created_at', { score: isoToScoreMs(createdAt), member: decisionId }));
      ops.push(kv.zremrangebyrank('admin:decisions:by_created_at', 0, -idxMax - 1));
      ops.push(kv.sadd(decTickerKey, decisionId));
      ops.push(kv.expire(decTickerKey, adminTtlSec));
      ops.push(
        kv.lpush(
          'admin:activity',
          JSON.stringify({
            ts: createdAt,
            type: 'decision_made',
            webhookId: adminWebhookId,
            decisionId,
            action: dec.action,
            ticker: result.signal.ticker,
          })
        )
      );
      ops.push(kv.ltrim('admin:activity', 0, activityMax - 1));

      const exec = result.execution as any;
      const placed = Boolean(exec?.executed && exec?.order);
      if (placed) {
        const orderId = `or_${randomUUID()}`;
        const orderCreatedAt = nowIso();
        const brokerOrderId = exec?.order?.id ? String(exec.order.id) : undefined;
        const brokerStatus = exec?.order?.status ? String(exec.order.status) : 'SUBMITTED';
        const side =
          result.decision.instrumentType === 'STOCK'
            ? result.signal.direction === 'LONG'
              ? 'buy'
              : 'sell_short'
            : 'buy_to_open';
        const optionSymbol = result.decision.optionContract?.symbol;

        const ord: AdminOrderRecord = {
          id: orderId,
          createdAt: orderCreatedAt,
          decisionId,
          brokerOrderId,
          symbol: result.signal.ticker,
          optionSymbol,
          side,
          quantity: result.decision.quantity,
          status: brokerStatus,
        };
        const orderKey = `admin:orders:${orderId}`;
        const decOrderKey = `admin:decisions:${decisionId}:order_id`;
        ops.push(kv.set(orderKey, ord));
        ops.push(kv.expire(orderKey, adminTtlSec));
        ops.push(kv.set(decOrderKey, orderId));
        ops.push(kv.expire(decOrderKey, adminTtlSec));
        ops.push(kv.zadd('admin:orders:by_created_at', { score: isoToScoreMs(orderCreatedAt), member: orderId }));
        ops.push(kv.zremrangebyrank('admin:orders:by_created_at', 0, -idxMax - 1));

        const positionId = `ps_${randomUUID()}`;
        const openedAt = nowIso();
        const pos: AdminPositionRecord = {
          id: positionId,
          openedAt,
          entryOrderId: orderId,
          entryDecisionId: decisionId,
          entryWebhookId: adminWebhookId,
          symbol: result.signal.ticker,
          direction: String(result.signal.direction ?? ''),
          quantity: result.decision.quantity,
          entryPrice: Number(result.decision.entryPrice ?? 0),
          stopLoss: Number(result.decision.stopLoss ?? 0),
          target1: Number(result.decision.target1 ?? 0),
          status: 'OPEN',
        };
        const posKey = `admin:positions:${positionId}`;
        const posSymbolKey = `admin:positions:by_symbol:${pos.symbol}`;
        const decPosKey = `admin:decisions:${decisionId}:position_id`;
        const whPosKey = `admin:webhooks:${adminWebhookId}:position_id`;

        ops.push(kv.set(posKey, pos));
        // Positions are important for monitoring; keep longer than webhooks/decisions by default.
        ops.push(kv.expire(posKey, clampInt(intEnv('ADMIN_KV_POSITIONS_TTL_DAYS', 180), 7, 3650) * 86400));
        ops.push(kv.sadd('admin:positions:open', positionId));
        ops.push(kv.sadd(posSymbolKey, positionId));
        ops.push(kv.expire(posSymbolKey, clampInt(intEnv('ADMIN_KV_POSITIONS_TTL_DAYS', 180), 7, 3650) * 86400));
        ops.push(kv.zadd('admin:positions:by_opened_at', { score: isoToScoreMs(openedAt), member: positionId }));
        ops.push(kv.zremrangebyrank('admin:positions:by_opened_at', 0, -idxMax - 1));
        ops.push(kv.set(decPosKey, positionId));
        ops.push(kv.expire(decPosKey, adminTtlSec));
        ops.push(kv.set(whPosKey, positionId));
        ops.push(kv.expire(whPosKey, adminTtlSec));
        ops.push(
          kv.lpush(
            'admin:activity',
            JSON.stringify({
              ts: openedAt,
              type: 'position_opened',
              positionId,
              decisionId,
              webhookId: adminWebhookId,
              symbol: pos.symbol,
              direction: pos.direction,
              qty: pos.quantity,
            })
          )
        );
        ops.push(kv.ltrim('admin:activity', 0, activityMax - 1));
      }

      await Promise.all(ops);

      const wh = (await kv.get<AdminWebhookRecord>(`admin:webhooks:${adminWebhookId}`)) ?? null;
      if (wh) {
        wh.processed = true;
        await kv.set(`admin:webhooks:${adminWebhookId}`, wh);
      }
    }

    await Promise.all([
      kv.set(id, record),
      kv.lpush('signals:list', id),
      kv.ltrim('signals:list', 0, 999),
      kv.incr('metrics:total_signals'),
      kv.incr(
        status === 'executed'
          ? 'metrics:signals_executed'
          : status === 'paper' || status === 'approved'
            ? 'metrics:signals_hold'
            : 'metrics:signals_rejected'
      ),
    ]);

    return NextResponse.json({
      status,
      kvConfigured: true,
      adminKv: adminKvEnabled ? { enabled: true, webhookId: adminWebhookId } : { enabled: false },
      id,
      signal: result.signal,
      validation: result.validation,
      scores: result.scores,
      decision: result.decision,
      shouldExecute: result.shouldExecute,
      execution: result.execution,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 400 }
    );
  }
}


