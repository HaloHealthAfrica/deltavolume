import { NextResponse } from 'next/server';
import { getDecision, getWebhook, getPosition } from '@/lib/admin/kv-admin';
import { kv } from '@vercel/kv';
import { requireAdminApi } from '@/lib/auth/route-guards';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const webhook = await getWebhook(id);
  if (!webhook) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [decisionId, positionId] = await Promise.all([
    kv.get<string>(`admin:webhooks:${id}:decision_id`),
    kv.get<string>(`admin:webhooks:${id}:position_id`),
  ]);

  const [decision, position] = await Promise.all([
    decisionId ? getDecision(String(decisionId)) : Promise.resolve(null),
    positionId ? getPosition(String(positionId)) : Promise.resolve(null),
  ]);

  return NextResponse.json({ webhook, decision, position, decisionId: decisionId ?? null, positionId: positionId ?? null });
}


