import { NextRequest, NextResponse } from 'next/server';
import { fetchTradierQuote } from '@/lib/dvu/integrations/tradier';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const ticker = req.nextUrl.searchParams.get('ticker');
    if (!ticker) return NextResponse.json({ error: 'Missing ticker' }, { status: 400 });
    const quote = await fetchTradierQuote(ticker);
    return NextResponse.json(quote);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    );
  }
}


