import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { verifyUser } from '@/lib/auth/user-store';

export const authOptions: NextAuthOptions = {
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim();
        const password = credentials?.password;
        if (!email || !password) return null;

        const user = await verifyUser(email, password);
        if (!user) return null;

        return {
          id: user.id,
          email: user.email,
          role: user.role ?? 'user',
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      if ((user as any)?.role) (token as any).role = (user as any).role;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        // next-auth types don't include id by default; we attach it.
        (session.user as any).id = token.sub;
        (session.user as any).role = (token as any).role ?? 'user';
      }
      return session;
    },
  },
};


