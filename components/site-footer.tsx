import Link from 'next/link';
import { Brand } from '@/components/brand';
import { withBase } from '@/lib/base-path';

export function SiteFooter() {
  const col = 'space-y-2.5 text-sm';
  const a = 'text-muted-foreground transition-colors hover:text-foreground';
  return (
    <footer className="mt-24 border-t border-white/6">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1.6fr]">
        <div className="space-y-3">
          <Brand />
          <p className="max-w-xs text-sm text-pretty text-muted-foreground">Human drivers against tiny neural networks, on the same simulated cars and tracks. A research project by Paul Brie.</p>
        </div>
        <nav aria-label="Play" className={col}>
          <div className="eyebrow text-muted-foreground/70">Play</div>
          <a className={`block ${a}`} href={withBase('/drive')}>Drive</a>
          <a className={`block ${a}`} href={withBase('/lab')}>Train a network</a>
          <Link className={`block ${a}`} href="/lobby">Race others</Link>
        </nav>
        <nav aria-label="Explore" className={col}>
          <div className="eyebrow text-muted-foreground/70">Explore</div>
          <Link className={`block ${a}`} href="/leaderboard">Leaderboard</Link>
          <Link className={`block ${a}`} href="/networks">Networks</Link>
          <Link className={`block ${a}`} href="/#how">How it works</Link>
        </nav>
        <div className={col}>
          <div className="eyebrow text-muted-foreground/70">Credits</div>
          <p className="text-pretty text-muted-foreground">
            Mercedes-AMG GLE 63 S Coupé model: <a className="underline underline-offset-2 hover:text-foreground" href="https://sketchfab.com/3d-models/mercedes-amg-gle-63-coupe-2022-ac4667c76f4e4e6c813ff3e72bc07ff8" rel="noreferrer">“Mercedes-AMG GLE 63 Coupe 2022”</a> by <a className="underline underline-offset-2 hover:text-foreground" href="https://sketchfab.com/ceron_alex" rel="noreferrer">ceron_alex</a>, CC BY 4.0, lightened for the sim.
            Rendering with three.js. Type: Archivo, Geist and Geist Mono (SIL OFL).
          </p>
        </div>
      </div>
    </footer>
  );
}
