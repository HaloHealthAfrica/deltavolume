import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth/options';
import { listOpenPositions } from '@/lib/admin/kv-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = (searchParams.get('status') ?? 'open').toLowerCase();
  const limitRaw = Number(searchParams.get('limit') ?? 25);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 25;

  if (status !== 'open') {
    // For now the admin dashboard needs only open positions.
    // Closed/all can be added once we implement admin positions management.
    return NextResponse.json({ positions: [], status, note: 'Only status=open is currently supported.' });
  }

  const positions = await listOpenPositions(limit);
  return NextResponse.json({ positions, status: 'open' });
}


