import NextAuth, { type DefaultSession } from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import type { Provider } from 'next-auth/providers';
import { withBase } from '@/lib/base-path';
import { isSuperAdmin } from '@/lib/admin';
import { noteSeen, noteSignIn } from '@/lib/dashboard/store.mjs';

declare module 'next-auth' {
  interface Session {
    /** admin: the super admin (lib/admin.ts), who creates and edits the maps */
    user: { id: string; admin: boolean } & DefaultSession['user'];
  }
}

export const googleEnabled = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
// A name-only sign-in for trying the game without Google: on in development, and in production
// only with AUTH_GUEST=1 (e.g. a staging deploy before the Google client exists).
export const guestEnabled = process.env.AUTH_GUEST === '1' || (process.env.AUTH_GUEST !== '0' && process.env.NODE_ENV !== 'production');

const providers: Provider[] = [];
if (googleEnabled) providers.push(Google);   // AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET from the environment
if (guestEnabled) providers.push(Credentials({
  id: 'guest',
  name: 'Guest',
  credentials: { name: { label: 'Driver name', type: 'text' } },
  authorize(c) {
    const name = String(c?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
    if (name.length < 2) return null;
    return { id: crypto.randomUUID(), name, image: null };
  },
}));

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 3600 },
  trustHost: true,                         // behind Railway's proxy, or the box's nginx
  basePath: withBase('/api/auth'),
  pages: { signIn: withBase('/signin') },
  callbacks: {
    jwt({ token, account, user, profile }) {
      // a stable id per account: "google:<sub>", or "guest:<uuid>" for this guest session
      if (account) {
        token.uid = `${account.provider}:${account.providerAccountId || user?.id}`;
        token.provider = account.provider;
        token.emailVerified = account.provider === 'google' && profile?.email_verified === true;
        if (account.provider !== 'google') delete token.email;
        // the dashboard's list of people (#357; never in the way of the sign-in)
        noteSignIn({ id: token.uid as string, provider: account.provider, name: token.name ?? user?.name, email: token.email ?? null, image: token.picture ?? user?.image ?? null });
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === 'string') {
        session.user.id = token.uid;
        noteSeen({ id: token.uid, name: session.user.name, email: token.email ?? null, image: session.user.image ?? null });   // (#357: every 10 min at most)
      }
      // worked out on every request from what Google said at sign-in, so a change of the constant applies at once
      session.user.admin = isSuperAdmin({ provider: token.provider as string | undefined, email: token.email, emailVerified: token.emailVerified as boolean | undefined });
      return session;
    },
  },
});

/** The signed-in super admin's session, or null (for pages and API routes that only the admin may use). */
export async function adminSession() {
  const session = await auth();
  return session?.user?.admin ? session : null;
}
