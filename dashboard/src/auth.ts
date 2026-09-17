import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { users } from './db/schema';

/**
 * Five named people, so access is an allowlist against the `users` table rather
 * than a self-serve signup flow. An address that isn't an active row there
 * cannot get in, whatever Google says about it.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: 'jwt' },
  pages: { signIn: '/signin' },
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;
      const row = await db.query.users.findFirst({ where: eq(users.email, email) });
      return Boolean(row?.active);
    },
    async jwt({ token }) {
      const email = token.email?.toLowerCase();
      if (!email) return token;
      const row = await db.query.users.findFirst({ where: eq(users.email, email) });
      if (row) {
        token.userId = row.id;
        token.role = row.role;
        token.name = row.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
});
