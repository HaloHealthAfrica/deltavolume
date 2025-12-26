import { NextResponse } from 'next/server';
import type { DVUWebhookPayload } from '@/lib/dvu/types';
import { processDVUWebhook } from '@/lib/dvu/engine';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as DVUWebhookPayload;
    const result = await processDVUWebhook(payload);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    );
  }
}


