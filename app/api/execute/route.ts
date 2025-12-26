import { NextResponse } from 'next/server';
import type { DVUWebhookPayload } from '@/lib/dvu/types';
import { processDVUWebhook } from '@/lib/dvu/engine';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as DVUWebhookPayload;
    const result = await processDVUWebhook(payload);

    // For manual execution endpoint, make it explicit if we ended up stock-based.
    // This endpoint is frequently used for testing; the main webhook path writes richer KV records.
    if (result?.decision?.instrumentType === 'STOCK') {
      return NextResponse.json(
        {
          ...result,
          warning:
            'Decision instrumentType is STOCK. If you intend to trade options only, set TRADE_INSTRUMENT=options and ensure option chain data is available (Tradier configured).',
        },
        { status: 200 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    );
  }
}



