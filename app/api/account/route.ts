import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Placeholder for Tradier/Alpaca account + positions aggregation.
export async function GET() {
  return NextResponse.json({
    status: 'not_implemented',
    message: 'Account/positions endpoint will be implemented after broker integration is wired.',
  });
}


