import { NextRequest, NextResponse } from 'next/server';
import { fetchTradierOptions } from '@/lib/dvu/integrations/tradier';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const ticker = req.nextUrl.searchParams.get('ticker');
    if (!ticker) return NextResponse.json({ error: 'Missing ticker' }, { status: 400 });
    const options = await fetchTradierOptions(ticker);
    return NextResponse.json({ ticker, options });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 400 }
    );
  }
}


