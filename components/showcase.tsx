// The pieces the public pages share (ticket #320): a duel between a human's lap and a network's, a track's board.
import Link from 'next/link';
import { Brain, User } from 'lucide-react';
import { TrackOutline } from '@/components/track-outline';
import { cn } from '@/lib/utils';
import { fmtGap, fmtLap, fmtLength, netLabel, publicName } from '@/lib/format';
import { GROUNDS, VEHICLES } from '@/lib/race/shared.mjs';
import type { Board, BoardRow, NetworkLap, Track } from '@/lib/showcase/store.mjs';

export const carName = (key: string) => VEHICLES.find(v => v.key === key)?.name ?? key;
export const groundLabel = (key: string) => GROUNDS.find(g => g.key === key)?.name ?? key;

export function SideTag({ side, className }: { side: 'human' | 'tnn'; className?: string }) {
  return (
    <span className={cn('eyebrow inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[0.65rem]', side === 'human' ? 'bg-human/12 text-human' : 'bg-tnn/12 text-tnn', className)}>
      {side === 'human' ? <User className="size-3" aria-hidden /> : <Brain className="size-3" aria-hidden />}
      {side === 'human' ? 'Human' : 'Network'}
    </span>
  );
}

/** Which lap a network's time is: its exam lap, or one it drove in a race room (and then, if saved, its exam lap when that is another). */
export const lapKind = (n: NetworkLap) => !n.room ? 'exam lap' : `race-room lap${!n.saved ? ', not saved' : n.exam != null && n.exam !== n.time ? `; exam ${fmtLap(n.exam)}` : ''}`;

/** Who is ahead, and by how much: gap is the network's lap less the human's. */
export function GapBadge({ gap, className }: { gap: number; className?: string }) {
  const tnn = gap < 0;
  return (
    <span className={cn('num inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', tnn ? 'border-tnn/30 bg-tnn/10 text-tnn' : 'border-human/30 bg-human/10 text-human', className)}>
      {tnn ? 'network' : 'human'} ahead by {Math.abs(gap).toFixed(3)} s
    </span>
  );
}

/** A track's board: the cars that have a lap on it, each with its best human lap and its best network lap. */
export function BoardCard({ board, track, full, limit, className }: { board: Board; track: Track; full: boolean; limit?: number; className?: string }) {
  const rows = limit ? board.rows.slice(0, limit) : board.rows;
  const lead = Math.min(board.human?.time ?? Infinity, board.tnn?.time ?? Infinity);
  return (
    <section className={cn('panel overflow-hidden', className)} aria-label={`${track.name}, ${groundLabel(board.ground)}`}>
      <header className="flex items-center gap-4 border-b border-white/6 p-5">
        <TrackOutline wp={track.wp} width={72} height={52} stroke={2.4} className="h-13 w-18 shrink-0 text-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="heading truncate text-xl">{track.name}</h3>
          <p className="num mt-0.5 text-xs text-muted-foreground">{groundLabel(board.ground)} · {fmtLength(track.length)} · {board.rows.length} {board.rows.length === 1 ? 'car' : 'cars'}</p>
        </div>
        {board.human && board.tnn && <GapBadge gap={board.tnn.time - board.human.time} className="hidden sm:inline-flex" />}
      </header>
      <div className="overflow-x-auto">{/* (a phone: the table scrolls, not cut off) */}
      <table className="w-full text-sm">
        <thead>
          <tr className="eyebrow text-[0.62rem] text-muted-foreground/80">
            <th scope="col" className="py-2.5 pr-2 pl-5 text-left font-medium">Car</th>
            <th scope="col" className="px-2 py-2.5 text-right font-medium"><span className="text-human">Human</span></th>
            <th scope="col" className="px-2 py-2.5 text-right font-medium"><span className="text-tnn">Network</span></th>
            <th scope="col" className="hidden py-2.5 pr-5 pl-2 text-right font-medium sm:table-cell">Gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => <Row key={r.vehicle} r={r} lead={lead} full={full} />)}
        </tbody>
      </table>
      </div>
      {limit != null && board.rows.length > limit && (
        <div className="border-t border-white/6 px-5 py-3 text-sm">
          <Link href={`/leaderboard#${board.track}-${board.ground}`} className="font-medium text-muted-foreground hover:text-foreground">All {board.rows.length} cars →</Link>
        </div>
      )}
    </section>
  );
}

function Row({ r, lead, full }: { r: BoardRow; lead: number; full: boolean }) {
  const gap = r.human && r.tnn ? r.tnn.time - r.human.time : null;
  const cell = (time: number | undefined, sub: string | null | undefined, side: 'human' | 'tnn', kind?: string) => (
    <td className="px-2 py-2.5 text-right align-top">
      {time == null ? <span className="text-muted-foreground/50">—</span> : (
        <>
          <span className={cn('num font-medium', time === lead && (side === 'human' ? 'text-human' : 'text-tnn'))}>{fmtLap(time)}</span>
          <span className="block max-w-36 truncate text-xs text-muted-foreground sm:ml-auto">{sub}</span>
          {kind && <span className="block max-w-36 text-[0.7rem] leading-snug text-pretty text-muted-foreground/70 sm:ml-auto">{kind}</span>}
        </>
      )}
    </td>
  );
  return (
    <tr className="border-t border-white/5">
      <th scope="row" className="max-w-40 truncate py-2.5 pr-2 pl-5 text-left align-top font-medium">{carName(r.vehicle)}</th>
      {cell(r.human?.time, r.human && publicName(r.human.name, full), 'human')}
      {cell(r.tnn?.time, r.tnn && netLabel(r.tnn, full), 'tnn', r.tnn ? lapKind(r.tnn) : undefined)}
      <td className={cn('num hidden py-2.5 pr-5 pl-2 text-right align-top text-xs sm:table-cell', gap == null ? 'text-muted-foreground/50' : gap < 0 ? 'text-tnn' : 'text-human')}>{gap == null ? '—' : fmtGap(gap)}</td>
    </tr>
  );
}
