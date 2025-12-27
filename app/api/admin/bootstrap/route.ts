import { NextRequest, NextResponse } from 'next/server';
import { createUser, getUserByEmail } from '@/lib/auth/user-store';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';

function bootstrapTokenOk(request: NextRequest): boolean {
  const expected = (process.env.ADMIN_BOOTSTRAP_TOKEN ?? '').trim();
  if (!expected) return false;
  const got = (request.headers.get('x-admin-bootstrap-token') ?? '').trim();
  return Boolean(got) && got === expected;
}

/**
 * One-time bootstrap endpoint for creating the first admin user.
 *
 * Security:
 * - Requires ADMIN_BOOTSTRAP_TOKEN and header: x-admin-bootstrap-token
 * - Refuses to run if an admin already exists (unless force=true)
 */
export async function POST(request: NextRequest) {
  if (!bootstrapTokenOk(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const kvConfigured = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  if (!kvConfigured) {
    return NextResponse.json({ error: 'KV not configured' }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as any;
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  const force = Boolean(body?.force);

  if (!email.includes('@')) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  const adminIndexKey = 'users:admins';
  const adminCount = Number((await kv.scard(adminIndexKey)) ?? 0);
  if (adminCount > 0 && !force) {
    return NextResponse.json(
      { error: 'Admin already exists. Pass { "force": true } to create another admin.' },
      { status: 409 }
    );
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    // Promote to admin if needed
    if (existing.role !== 'admin') {
      const updated = { ...existing, role: 'admin' as const };
      await Promise.all([
        kv.set(`users:email:${email}`, updated),
        kv.sadd(adminIndexKey, email),
      ]);
    }
    return NextResponse.json({ id: existing.id, email: existing.email, role: 'admin', note: 'Existing user promoted (if needed).' });
  }

  const user = await createUser(email, password, { role: 'admin' });
  await kv.sadd(adminIndexKey, user.email);

  return NextResponse.json({ id: user.id, email: user.email, role: user.role ?? 'admin' }, { status: 201 });
}


