import { NextRequest, NextResponse } from 'next/server';
import { closePosition } from '@/lib/admin/kv-admin';
import { requireAdminApi } from '@/lib/auth/route-guards';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as any;
  const updated = await closePosition(id, {
    exitReason: body?.exitReason,
    exitPrice: typeof body?.exitPrice === 'number' ? body.exitPrice : undefined,
    notes: body?.notes,
  });

  return NextResponse.json({ position: updated });
}


