import { getServerSession } from 'next-auth/next';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth/options';
import { isAdminSession } from '@/lib/auth/admin';

export async function requireAdminApi() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !isAdminSession(session)) {
    return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { ok: true as const, session };
}


