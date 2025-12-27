import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { kvConfigured } from '@/lib/admin/kv-admin';
import { requireAdminApi } from '@/lib/auth/route-guards';

export const dynamic = 'force-dynamic';

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function adminRetentionSeconds(): number {
  const days = clampInt(intEnv('ADMIN_KV_RETENTION_DAYS', 30), 1, 365);
  return days * 86400;
}

function positionsTtlSeconds(): number {
  const days = clampInt(intEnv('ADMIN_KV_POSITIONS_TTL_DAYS', 180), 7, 3650);
  return days * 86400;
}

function isoToScoreMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

function randomId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function minutesAgoIso(mins: number) {
  return new Date(Date.now() - mins * 60_000).toISOString();
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  if (!kvConfigured()) {
    return NextResponse.json({ error: 'KV not configured' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as any;
  const force = Boolean(body?.force);
  const already = await kv.get<string>('admin:seed:last_run');
  if (already && !force) {
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason: 'Seed already ran. Pass { "force": true } to run again.',
      lastRun: already,
    });
  }

  const adminTtl = adminRetentionSeconds();
  const posTtl = positionsTtlSeconds();

  const tickers = ['SPY', 'QQQ', 'AAPL', 'TSLA', 'NVDA', 'MSFT'];
  const dirs = ['LONG', 'SHORT'] as const;
  const sources = ['SCANNER', 'DVU_FULL'] as const;

  let webhooksCreated = 0;
  let decisionsCreated = 0;
  let positionsOpen = 0;
  let positionsClosed = 0;
  let signalsCreated = 0;

  // Create webhooks + decisions (today), plus some executed positions
  for (let i = 0; i < 25; i++) {
    const webhookId = randomId('wh');
    const ticker = tickers[i % tickers.length];
    const direction = dirs[i % dirs.length];
    const source = sources[i % sources.length];
    const receivedAt = minutesAgoIso(5 + i * 3);

    const wh = {
      id: webhookId,
      receivedAt,
      processed: true,
      source,
      ticker,
      direction,
      quality: i % 5 === 0 ? 'MEGA' : i % 7 === 0 ? 'LEGENDARY' : 'HIGH',
      confluenceScore: 4 + (i % 4),
      rawPayload: { seed: true, ticker, direction, source, receivedAt, idx: i },
    };

    const decisionId = randomId('dc');
    const action = i % 5 === 0 ? 'EXECUTE' : i % 3 === 0 ? 'PAPER' : 'SKIP';
    const createdAt = receivedAt;

    const dec = {
      id: decisionId,
      createdAt,
      webhookId,
      action,
      instrument: 'CALL',
      reason: action === 'SKIP' ? 'Seeded: filtered out (example)' : 'Seeded: approved',
      finalConfidence: action === 'SKIP' ? 48.2 : action === 'PAPER' ? 62.7 : 78.9,
      enrichmentData: { seed: true, ticker, direction, action },
    };

    const ops: Promise<any>[] = [];
    ops.push(kv.set(`admin:webhooks:${webhookId}`, wh));
    ops.push(kv.expire(`admin:webhooks:${webhookId}`, adminTtl));
    ops.push(kv.zadd('admin:webhooks:by_received_at', { score: isoToScoreMs(receivedAt), member: webhookId }));
    ops.push(kv.sadd(`admin:webhooks:by_ticker:${ticker}`, webhookId));
    ops.push(kv.expire(`admin:webhooks:by_ticker:${ticker}`, adminTtl));

    ops.push(kv.set(`admin:decisions:${decisionId}`, dec));
    ops.push(kv.expire(`admin:decisions:${decisionId}`, adminTtl));
    ops.push(kv.zadd('admin:decisions:by_created_at', { score: isoToScoreMs(createdAt), member: decisionId }));
    ops.push(kv.sadd(`admin:decisions:by_ticker:${ticker}`, decisionId));
    ops.push(kv.expire(`admin:decisions:by_ticker:${ticker}`, adminTtl));

    ops.push(kv.set(`admin:webhooks:${webhookId}:decision_id`, decisionId));
    ops.push(kv.expire(`admin:webhooks:${webhookId}:decision_id`, adminTtl));

    ops.push(
      kv.lpush(
        'admin:activity',
        JSON.stringify({ ts: receivedAt, type: 'webhook_received', webhookId, ticker, direction, source })
      )
    );
    ops.push(
      kv.lpush(
        'admin:activity',
        JSON.stringify({ ts: createdAt, type: 'decision_made', webhookId, decisionId, action, ticker })
      )
    );

    // Create positions for EXECUTE decisions (some open, some closed)
    if (action === 'EXECUTE') {
      const positionId = randomId('ps');
      const openedAt = createdAt;
      const isClosed = i % 10 === 0;
      const closedAt = isClosed ? minutesAgoIso(2 + i) : undefined;

      const pos = {
        id: positionId,
        openedAt,
        closedAt,
        entryOrderId: randomId('or'),
        entryDecisionId: decisionId,
        entryWebhookId: webhookId,
        symbol: ticker,
        direction,
        quantity: 1 + (i % 3),
        entryPrice: 2.15 + (i % 5) * 0.35,
        stopLoss: 1.25,
        target1: 3.25,
        status: isClosed ? 'CLOSED' : 'OPEN',
        realizedPnl: isClosed ? (i % 2 === 0 ? 125.5 : -90.25) : undefined,
        unrealizedPnl: !isClosed ? (i % 2 === 0 ? 45.75 : -32.1) : undefined,
        exitReason: isClosed ? 'TARGET_HIT' : undefined,
      };

      ops.push(kv.set(`admin:positions:${positionId}`, pos));
      ops.push(kv.expire(`admin:positions:${positionId}`, posTtl));
      ops.push(kv.zadd('admin:positions:by_opened_at', { score: isoToScoreMs(openedAt), member: positionId }));
      ops.push(kv.sadd(`admin:positions:by_symbol:${ticker}`, positionId));
      ops.push(kv.expire(`admin:positions:by_symbol:${ticker}`, posTtl));
      if (!isClosed) {
        ops.push(kv.sadd('admin:positions:open', positionId));
        positionsOpen += 1;
      } else {
        positionsClosed += 1;
      }

      ops.push(kv.set(`admin:webhooks:${webhookId}:position_id`, positionId));
      ops.push(kv.expire(`admin:webhooks:${webhookId}:position_id`, adminTtl));
      ops.push(
        kv.lpush(
          'admin:activity',
          JSON.stringify({ ts: openedAt, type: 'position_opened', positionId, decisionId, webhookId, symbol: ticker, direction, qty: pos.quantity })
        )
      );
    }

    await Promise.all(ops);
    webhooksCreated += 1;
    decisionsCreated += 1;
  }

  // Seed a few legacy dashboard signals so /admin/signals has data too.
  for (let i = 0; i < 10; i++) {
    const ticker = tickers[(i + 1) % tickers.length];
    const ts = minutesAgoIso(10 + i * 7);
    const id = `signals:${ts}:${ticker}:${crypto.randomUUID()}`;
    const record = {
      id,
      receivedAt: nowIso(),
      ticker,
      timeframe_minutes: 15,
      timestamp: ts,
      type: i % 2 === 0 ? 'DVU_FULL' : 'DVU_SCANNER',
      direction: i % 2 === 0 ? 'LONG' : 'SHORT',
      quality: 4,
      entry: 450.25 + i,
      pattern: '2-2 REV',
      decision: i % 4 === 0 ? 'executed' : i % 3 === 0 ? 'paper' : 'skipped',
      reason: 'Seeded signal',
      shares: 1 + (i % 3),
      quantity: 1 + (i % 3),
      instrumentType: 'CALL',
      confidence: 72.5,
      webhook: { seed: true },
    };
    await Promise.all([kv.set(id, record), kv.lpush('signals:list', id)]);
    signalsCreated += 1;
  }
  await kv.ltrim('signals:list', 0, 999);

  await Promise.all([
    kv.ltrim('admin:activity', 0, 499),
    kv.set('admin:seed:last_run', nowIso()),
  ]);

  return NextResponse.json({
    ok: true,
    seededAt: await kv.get('admin:seed:last_run'),
    counts: {
      webhooksCreated,
      decisionsCreated,
      positionsOpen,
      positionsClosed,
      signalsCreated,
    },
    note: 'Visit /admin (and /admin/webhooks, /admin/trades, /admin/positions, /admin/signals).',
  });
}


