import { NextRequest, NextResponse } from 'next/server';
import { listSignals } from '@/lib/admin/kv-admin';
import { requireAdminApi } from '@/lib/auth/route-guards';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const limitRaw = Number(searchParams.get('limit') ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 50;

  const signals = await listSignals(limit);
  return NextResponse.json({ signals });
}


