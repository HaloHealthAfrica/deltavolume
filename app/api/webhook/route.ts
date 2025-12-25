import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { randomUUID } from 'crypto';
import { DecisionEngine, Strategy, type WebhookData } from '@/lib/decision-engine';

export const dynamic = 'force-dynamic';

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseNumber(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseStrategy(value: string | undefined): Strategy {
  const v = (value ?? '').trim().toLowerCase();
  const allowed = new Set<string>(Object.values(Strategy));
  return (allowed.has(v) ? (v as Strategy) : Strategy.BALANCED);
}

function kvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function buildEngine() {
  const strategy = parseStrategy(process.env.STRATEGY);
  const riskPerTrade = parseNumber(process.env.RISK_PER_TRADE, 100);
  const maxRiskPerShare = parseNumber(process.env.MAX_RISK_PER_SHARE, 2.0);
  const minRRRatio = parseNumber(process.env.MIN_RR_RATIO, 1.3);
  const allowedTickers = parseCsv(process.env.ALLOWED_TICKERS);
  const allowedTimeframes = parseCsv(process.env.ALLOWED_TIMEFRAMES)
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));

  return {
    engine: new DecisionEngine({
      strategy,
      riskPerTrade,
      maxRiskPerShare,
      minRRRatio,
      allowedTickers,
      allowedTimeframes,
    }),
    config: { strategy, riskPerTrade, maxRiskPerShare, minRRRatio, allowedTickers, allowedTimeframes },
  };
}

export async function GET() {
  const { config } = buildEngine();
  return NextResponse.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    strategy: config.strategy,
    riskPerTrade: config.riskPerTrade,
    kvConfigured: kvConfigured(),
  });
}

export async function POST(request: Request) {
  try {
    const data = (await request.json()) as WebhookData;
    const { engine, config } = buildEngine();
    const decision = engine.evaluate(data);

    const executed = Boolean(decision.execute && (decision.shares ?? 0) > 0);
    const status = executed ? 'executed' : 'rejected';

    // Still return a decision even if KV isn't configured (useful for local testing).
    if (!kvConfigured()) {
      return NextResponse.json({
        status,
        kvConfigured: false,
        decision,
      });
    }

    const id = `signals:${new Date().toISOString()}:${data.market.ticker}:${randomUUID()}`;

    const record = {
      id,
      receivedAt: new Date().toISOString(),
      // Flatten key fields used by the dashboard components:
      ticker: data.market.ticker,
      timeframe_minutes: data.market.timeframe_minutes,
      timestamp: data.market.timestamp,
      type: data.signal.type,
      quality: data.signal.quality,
      quality_stars: data.signal.quality_stars,
      entry: data.price.entry,
      pattern: data.strat?.pattern?.name,
      decision: status,
      reason: decision.reason,
      shares: decision.shares ?? 0,
      // Full payloads for debugging/iteration:
      webhook: data,
      evaluated: decision,
      strategy: config.strategy,
    };

    await Promise.all([
      kv.set(id, record),
      kv.lpush('signals:list', id),
      kv.ltrim('signals:list', 0, 999),
      kv.incr('metrics:total_signals'),
      kv.incr(executed ? 'metrics:signals_executed' : 'metrics:signals_rejected'),
    ]);

    return NextResponse.json({
      status,
      kvConfigured: true,
      id,
      decision,
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


