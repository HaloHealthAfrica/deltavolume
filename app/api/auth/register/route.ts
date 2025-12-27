import { NextResponse } from 'next/server';
import { createUser } from '@/lib/auth/user-store';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = (body.email ?? '').trim().toLowerCase();
    const password = body.password ?? '';

    if (!email.includes('@')) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const user = await createUser(email, password, { role: 'user' });
    return NextResponse.json({ id: user.id, email: user.email, role: user.role ?? 'user' }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status = message === 'User already exists' ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}


