import { redirect } from 'next/navigation';
import { auth, googleEnabled, guestEnabled, signIn } from '@/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Brand } from '@/components/brand';
import { withBase } from '@/lib/base-path';

export default async function Home({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
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
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden p-6">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,oklch(0.42_0.09_60/.55),transparent_60%),radial-gradient(ellipse_at_bottom_right,oklch(0.55_0.16_45/.35),transparent_55%)]" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-[repeating-radial-gradient(ellipse_at_50%_140%,oklch(0.5_0.08_70/.18)_0_18px,transparent_18px_44px)] mask-[linear-gradient(to_bottom,transparent,black_70%)]" />
      <div className="relative grid w-full max-w-5xl items-center gap-10 md:grid-cols-[1.2fr_1fr]">
        <section className="space-y-6">
          <Brand className="text-lg" />
          <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
            Race your friends across the dunes, in real time.
          </h1>
          <p className="max-w-prose text-lg text-pretty text-muted-foreground">
            A full vehicle simulation, raycast suspension, tyres that sink and dig, a figure-8 course with a bridge,
            and up to eight drivers in a room. Pick a car, paint it, line up on the grid.
          </p>
          <ul className="grid max-w-md grid-cols-3 gap-3 text-sm">
            {[['8', 'drivers a room'], ['8', 'cars, buggy to V8'], ['3', 'grounds']].map(([n, l]) => (
              <li key={l} className="rounded-lg border bg-card/60 p-3">
                <div className="text-2xl font-bold text-primary">{n}</div>
                <div className="text-muted-foreground">{l}</div>
              </li>
            ))}
          </ul>
        </section>

        <Card className="bg-card/85 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-xl">Sign in to race</CardTitle>
            <CardDescription>Your name and picture show on your car and in the standings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Sign-in failed ({error}). Try again.
              </p>
            )}
            {googleEnabled ? (
              <form action={google}>
                <Button type="submit" size="lg" className="w-full">
                  <GoogleMark /> Continue with Google
                </Button>
              </form>
            ) : (
              <p className="rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                Google sign-in is not set up on this server yet (AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET).
              </p>
            )}
            {guestEnabled && (
              <>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <Separator className="flex-1" /> or try it as a guest <Separator className="flex-1" />
                </div>
                <form action={guest} className="space-y-2">
                  <Label htmlFor="guest-name">Driver name</Label>
                  <div className="flex gap-2">
                    <Input id="guest-name" name="name" required minLength={2} maxLength={24} autoComplete="nickname" placeholder="e.g. Dune Fox" />
                    <Button type="submit" variant="secondary">Play</Button>
                  </div>
                </form>
              </>
            )}
          </CardContent>
          <CardFooter className="text-xs text-muted-foreground">
            Keyboard driving: W A S D or the arrow keys. Best on a desktop browser.
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="size-4">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}
