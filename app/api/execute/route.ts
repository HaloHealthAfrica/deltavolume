import { NextResponse } from 'next/server';
import type { DVUWebhookPayload } from '@/lib/dvu/types';
import { processDVUWebhook } from '@/lib/dvu/engine';

export const dynamic = 'force-dynamic';

// NOTE: This is a stub for the "execute" step.
// We intentionally DO NOT place real orders yet; this endpoint returns what it *would* do.
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as DVUWebhookPayload;
    const result = await processDVUWebhook(payload);

    const enabled = String(process.env.ENABLE_AUTO_TRADING ?? 'false').toLowerCase() === 'true';
    if (!enabled) {
      return NextResponse.json({
        status: 'disabled',
        message: 'ENABLE_AUTO_TRADING is false; no orders were placed.',
        decision: result.decision,
        scores: result.scores,
        validation: result.validation,
      });
    }

    // Future: Place order via Tradier here.
    return NextResponse.json({
      status: 'not_implemented',
      message: 'Auto execution is enabled but order placement is not implemented yet.',
      decision: result.decision,
      scores: result.scores,
      validation: result.validation,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    );
  }
}


