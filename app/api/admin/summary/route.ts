import { NextResponse } from 'next/server';
import { getAdminSummary } from '@/lib/admin/kv-admin';
import { requireAdminApi } from '@/lib/auth/route-guards';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const summary = await getAdminSummary();
  return NextResponse.json(summary);
}


