import { NextResponse } from 'next/server';
import { fetchAlpacaMarketStatus } from '@/lib/dvu/integrations/alpaca';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = await fetchAlpacaMarketStatus();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    );
  }
}


