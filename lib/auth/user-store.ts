import { kv } from '@vercel/kv';
import bcrypt from 'bcryptjs';

export type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
};

function userKey(email: string) {
  return `users:email:${email.toLowerCase()}`;
}

export async function getUserByEmail(email: string): Promise<UserRecord | null> {
  const kvConfigured = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  if (!kvConfigured) return null;

  const user = await kv.get<UserRecord>(userKey(email));
  return user ?? null;
}

export async function createUser(email: string, password: string): Promise<UserRecord> {
  const kvConfigured = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  if (!kvConfigured) {
    throw new Error('KV is not configured. Create/connect Vercel KV and set KV_* env vars.');
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    throw new Error('User already exists');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user: UserRecord = {
    id: `user_${crypto.randomUUID()}`,
    email: email.toLowerCase(),
    passwordHash,
    createdAt: new Date().toISOString(),
  };

  await kv.set(userKey(email), user);
  return user;
}

export async function verifyUser(email: string, password: string): Promise<UserRecord | null> {
  const user = await getUserByEmail(email);
  if (!user) return null;

  const ok = await bcrypt.compare(password, user.passwordHash);
  return ok ? user : null;
}


