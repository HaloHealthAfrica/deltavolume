import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { randomUUID } from 'crypto';
import { normalizeWebhookPayload, processDVUWebhook } from '@/lib/dvu/engine';
import type { DVUWebhookPayload } from '@/lib/dvu/types';

export const dynamic = 'force-dynamic';

function kvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
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

    // Reject stale signals (> 2 minutes by default).
    const maxAgeMs = Number(process.env.SIGNAL_MAX_AGE_MS ?? 2 * 60 * 1000);
    if (!Number.isFinite(normalized.timestamp) || Date.now() - normalized.timestamp > maxAgeMs) {
      return NextResponse.json({ error: 'Stale signal', timestamp: normalized.timestamp }, { status: 400 });
    }

    // Daily trade count (KV-backed when configured)
    const dailyKey = `metrics:daily_trades:${utcDayKey()}`;
    const dailyTradeCount = kvConfigured() ? Number((await kv.get(dailyKey)) ?? 0) : 0;

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
    if (!kvConfigured()) {
      return NextResponse.json({
        status,
        kvConfigured: false,
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
      shares: result.decision.quantity,
      action: result.decision.action,
      instrumentType: result.decision.instrumentType,
      confidence: result.decision.confidence,
      // Full payloads for debugging/iteration:
      webhook: data,
      evaluated: result,
    };

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

    // Increment daily trade count only when we actually executed a trade.
    if (status === 'executed') {
      await kv.incr(dailyKey);
    }

    return NextResponse.json({
      status,
      kvConfigured: true,
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


