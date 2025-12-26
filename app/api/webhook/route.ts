import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { randomUUID } from 'crypto';
import { processDVUWebhook } from '@/lib/dvu/engine';
import type { DVUWebhookPayload } from '@/lib/dvu/types';

export const dynamic = 'force-dynamic';

function kvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

function webhookAuthed(request: Request): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return true; // disabled unless configured
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const headerToken = request.headers.get('x-webhook-token');
  return token === secret || headerToken === secret;
}

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    kvConfigured: kvConfigured(),
    minConfluenceScore: Number(process.env.MIN_CONFLUENCE_SCORE ?? 5),
    enableAutoTrading: String(process.env.ENABLE_AUTO_TRADING ?? 'false'),
  });
}

export async function POST(request: Request) {
  try {
    if (!webhookAuthed(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = (await request.json()) as DVUWebhookPayload;
    const result = await processDVUWebhook(data);

    const status = result.validation.isValid ? 'processed' : 'rejected';

    // Still return a decision even if KV isn't configured (useful for local testing).
    if (!kvConfigured()) {
      return NextResponse.json({
        status,
        kvConfigured: false,
        validation: result.validation,
        scores: result.scores,
        decision: result.decision,
        enrichment: result.enrichment,
      });
    }

    const isoTs = new Date(data.market.timestamp).toISOString();
    const id = `signals:${isoTs}:${data.market.ticker}:${randomUUID()}`;

    const record = {
      id,
      receivedAt: new Date().toISOString(),
      // Flatten key fields used by the dashboard components:
      ticker: data.market.ticker,
      timeframe_minutes: data.market.timeframe_minutes,
      timestamp: isoTs,
      type: data.signal.type,
      direction: data.signal.direction,
      quality: data.confluence?.total_score ?? data.signal.confluence_score,
      quality_stars: data.signal.quality_stars,
      entry: data.price.entry,
      pattern: data.strat?.patterns?.detected_name,
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
      kv.incr(status === 'processed' ? 'metrics:signals_executed' : 'metrics:signals_rejected'),
    ]);

    return NextResponse.json({
      status,
      kvConfigured: true,
      id,
      validation: result.validation,
      scores: result.scores,
      decision: result.decision,
      shouldExecute: result.shouldExecute,
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


