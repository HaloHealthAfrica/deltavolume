// app/api/signals/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    
    // Get signal IDs
    const kvConfigured = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
    if (!kvConfigured) {
      return NextResponse.json({ signals: [], total: 0, kvConfigured: false });
    }

    const signalIds = await kv.lrange<string>('signals:list', 0, limit - 1);
    
    // Get signal data
    const signals = await Promise.all(
      signalIds.map(async (id: string) => {
        const signal = await kv.get<Record<string, unknown>>(id);
        return { id, ...(signal ?? {}) };
      })
    );
    
    return NextResponse.json({
      signals,
      total: signals.length,
      kvConfigured: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch signals' },
      { status: 500 }
    );
  }
}
