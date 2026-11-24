import { redirect } from 'next/navigation';
import { auth, googleEnabled, guestEnabled, signIn } from '@/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SiteNav } from '@/components/site-nav';
import { withBase } from '@/lib/base-path';

export const metadata = { title: 'Sign in' };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const to = next && next.startsWith('/') && !next.startsWith('//') ? next : '/lobby';
  const session = await auth();
  if (session?.user) redirect(to);

  async function google() {
    'use server';
    await signIn('google', { redirectTo: withBase(to) });
  }
  async function guest(form: FormData) {
    'use server';
    await signIn('guest', { name: String(form.get('name') || ''), redirectTo: withBase(to) });
  }

  return (
    <div className="relative min-h-dvh overflow-hidden">
      <div aria-hidden className="grid-fade pointer-events-none absolute inset-0" />
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 size-[640px] -translate-x-1/2 rounded-full bg-primary/12 blur-3xl" />
      <SiteNav user={null} active="signin" />
      <main className="relative mx-auto grid max-w-5xl items-center gap-12 px-4 py-16 sm:px-6 md:grid-cols-[1.1fr_1fr] md:py-24">
        <section className="space-y-5">
          <p className="eyebrow text-primary">Sign in</p>
          <h1 className="display text-4xl text-balance sm:text-5xl">Race others. Keep your laps and your networks.</h1>
          <ul className="max-w-md space-y-3 text-muted-foreground">
            {[
              ['Race rooms', 'up to eight drivers on a grid, live.'],
              ['Your best laps', 'on the leaderboard, next to the networks’.'],
              ['Your networks', 'saved on the server, for anyone to load and beat.'],
            ].map(([b, t]) => <li key={b} className="flex gap-3"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" /><span><b className="font-medium text-foreground">{b}</b>: {t}</span></li>)}
          </ul>
          <p className="text-sm text-muted-foreground">
            Just want to drive, or train a network on your own? <a className="font-medium text-foreground underline underline-offset-4" href={withBase('/drive')}>Drive now</a>, no account needed.
          </p>
        </section>

        <section className="panel space-y-5 p-6 sm:p-8" aria-labelledby="signin-title">
          <div>
            <h2 id="signin-title" className="heading text-2xl">Welcome to Carsim</h2>
            <p className="mt-1 text-sm text-muted-foreground">Your name and picture show on your car and next to your laps.</p>
          </div>
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Sign-in failed ({error}). Try again.
            </p>
          )}
          {googleEnabled ? (
            <form action={google}>
              <Button type="submit" size="xl" variant="secondary" className="w-full bg-white text-[#1f1f1f] hover:bg-white/90">
                <GoogleMark /> Continue with Google
              </Button>
            </form>
          ) : (
            <p className="rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              Google sign-in is not set up on this server yet (AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET).
            </p>
          )}
          {guestEnabled && (
            <>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" /> or as a guest <span className="h-px flex-1 bg-border" />
              </div>
              <form action={guest} className="space-y-2">
                <Label htmlFor="guest-name">Driver name</Label>
                <div className="flex gap-2">
                  <Input id="guest-name" name="name" required minLength={2} maxLength={24} autoComplete="nickname" placeholder="e.g. Dune Fox" className="h-11" />
                  <Button type="submit" size="xl" className="h-11">Go</Button>
                </div>
              </form>
            </>
          )}
          <p className="text-xs text-muted-foreground">Keyboard driving (W A S D or the arrow keys), best in a desktop browser.</p>
        </section>
      </main>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="size-5">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}
