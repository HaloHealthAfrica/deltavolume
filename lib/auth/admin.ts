import type { Session } from 'next-auth';

export function isAdminSession(session: Session | null | undefined): boolean {
  const role = (session?.user as any)?.role;
  if (role === 'admin') return true;

  // Optional fallback: allow a single configured email as admin.
  const adminEmail = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const email = (session?.user?.email ?? '').trim().toLowerCase();
  return Boolean(adminEmail && email && adminEmail === email);
}


