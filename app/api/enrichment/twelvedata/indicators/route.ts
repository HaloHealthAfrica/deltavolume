import { NextRequest, NextResponse } from 'next/server';
import { fetchTwelveDataIndicators } from '@/lib/dvu/integrations/twelvedata';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const ticker = req.nextUrl.searchParams.get('ticker');
    const tf = req.nextUrl.searchParams.get('timeframe_minutes');
    const timeframeMinutes = Number(tf);
    if (!ticker) return NextResponse.json({ error: 'Missing ticker' }, { status: 400 });
    if (!Number.isFinite(timeframeMinutes)) {
      return NextResponse.json({ error: 'Missing/invalid timeframe_minutes' }, { status: 400 });
    }

    const indicators = await fetchTwelveDataIndicators(ticker, timeframeMinutes);
    return NextResponse.json({ ticker, timeframe_minutes: timeframeMinutes, indicators });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    );
  }
}


