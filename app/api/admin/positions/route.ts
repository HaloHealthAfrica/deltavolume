import { NextRequest, NextResponse } from 'next/server';
import { listPositions } from '@/lib/admin/kv-admin';
import { requireAdminApi } from '@/lib/auth/route-guards';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const status = (searchParams.get('status') ?? 'open').toLowerCase();
  const limitRaw = Number(searchParams.get('limit') ?? 25);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 25;

  const s = status === 'closed' ? 'closed' : status === 'all' ? 'all' : 'open';
  const positions = await listPositions({ status: s, limit });
  return NextResponse.json({ positions, status: s });
}


