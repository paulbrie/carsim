'use client';
// The chat (#325): the main room ('main': everyone connected to the race server) and the race room's ('room': its
// drivers). ChatBox is the full chat (the lobby's, the race room panel's tab); ChatOverlay is the race's: the last
// messages over the track for a few seconds, and a line to write on (Enter in the sim opens it, Esc goes back to
// driving). The super admin deletes messages and mutes drivers from here; the server checks it is them.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useSubject } from 'subjecto/react';
import { toast } from 'sonner';
import { MessageSquare, Mic, MicOff, SendHorizontal, Trash2 } from 'lucide-react';
import { SegmentedControl, SegmentedControlIndicator, SegmentedControlItem } from '@ui-sdk/react/segmented-control';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DriverAvatar } from '@/components/user-menu';
import { cn } from '@/lib/utils';
import { chat$, chatMutes$, send, sendChat } from '@/lib/client/net';
import type { ChatChannel, ChatMsg } from '@/lib/race/types';

export const CHAT_MAX = 500;
export const CHANNEL_NAME: Record<ChatChannel, string> = { room: 'This race', main: 'Everyone' };
const MUTE_HOURS = 24;

const hhmm = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** messages in a channel since it was last shown (not ours), and a function to mark it read */
// (the history a page gets when it opens, or joins a room, is not new: what is older than the page is read)
export function useUnread(ch: ChatChannel, shown: boolean, meId?: string) {
  const [msgs] = useSubject(chat$[ch]);
  const [seenAt, setSeenAt] = useState(() => Date.now());
  const lastAt = msgs.at(-1)?.at ?? 0;
  useEffect(() => { if (shown) setSeenAt(t => Math.max(t, Date.now(), lastAt)); }, [shown, lastAt]);
  if (shown) return 0;
  return msgs.filter(m => m.at > seenAt && m.uid !== meId).length;
}

export interface ChatBoxHandle { focus(): void }

/** the chat of one or two channels (tabs), with the line to write on */
export const ChatBox = forwardRef<ChatBoxHandle, {
  channels: ChatChannel[]; meId?: string; admin?: boolean; className?: string; onEscape?: () => void;
}>(function ChatBox({ channels, meId, admin, className, onEscape }, handle) {
  const [ch, setCh] = useState<ChatChannel>(channels[0]!);
  const cur = channels.includes(ch) ? ch : channels[0]!;
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(handle, () => ({ focus: () => input.current?.focus() }), []);
  const other = channels.find(c => c !== cur);
  const unreadOther = useUnread(other ?? cur, !other, meId);
  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      {channels.length > 1 && (
        <SegmentedControl aria-label="Chat room" className="seg mb-3 w-full" value={cur} onValueChange={v => v && setCh(v as ChatChannel)}>
          <SegmentedControlIndicator className="seg-indicator" />
          {channels.map(c => (
            <SegmentedControlItem key={c} value={c} className="seg-item flex-1 text-center">
              {CHANNEL_NAME[c]}
              {c === other && unreadOther > 0 && <span className="num ml-1.5 rounded-full bg-primary px-1.5 text-[0.7rem] text-primary-foreground">{unreadOther}</span>}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      )}
      <MessageList ch={cur} meId={meId} admin={admin} />
      <ChatInput ref={input} ch={cur} onEscape={onEscape} className="mt-3" />
    </div>
  );
});

function MessageList({ ch, meId, admin }: { ch: ChatChannel; meId?: string; admin?: boolean }) {
  const [msgs] = useSubject(chat$[ch]);
  const [mutes] = useSubject(chatMutes$);
  const muted = useMemo(() => new Set(mutes.map(m => m.id)), [mutes]);
  const box = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  // stay at the newest message, unless scrolled up to read; our own always shows
  useEffect(() => {
    const el = box.current; if (!el) return;
    if (atEnd.current || msgs.at(-1)?.uid === meId) el.scrollTop = el.scrollHeight;
  }, [msgs, meId, ch]);
  return (
    <div ref={box} role="log" aria-label={`Chat: ${CHANNEL_NAME[ch]}`} aria-live="polite" tabIndex={0}
      onScroll={e => { const el = e.currentTarget; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
      className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/8 bg-black/20 p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {!msgs.length ? (
        <div className="flex h-full min-h-24 flex-col items-center justify-center gap-1.5 p-4 text-center text-sm text-muted-foreground">
          <MessageSquare className="size-5 opacity-60" aria-hidden />
          <p>No messages yet.</p>
          <p className="text-xs">{ch === 'main' ? 'Everyone on the race server reads this room.' : 'Only the drivers in this room read this.'}</p>
        </div>
      ) : (
        <ol className="space-y-0.5">
          {msgs.map((m, i) => {
            const prev = msgs[i - 1], cont = !!prev && prev.uid === m.uid && m.at - prev.at < 3 * 60_000;
            return <Message key={m.id} m={m} ch={ch} cont={cont} mine={m.uid === meId} admin={admin && m.uid !== meId} muted={muted.has(m.uid)} />;
          })}
        </ol>
      )}
    </div>
  );
}

function Message({ m, ch, cont, mine, admin, muted }: { m: ChatMsg; ch: ChatChannel; cont: boolean; mine: boolean; admin?: boolean; muted: boolean }) {
  const mute = (hours: number) => {
    send({ t: 'chatMute', id: m.uid, name: m.name, hours });
    if (hours) toast.message(`${m.name} is muted for ${hours} h`, { action: { label: 'Undo', onClick: () => send({ t: 'chatMute', id: m.uid, hours: 0 }) } });
    else toast.message(`${m.name} can write again`);
  };
  return (
    <li className={cn('group relative flex gap-2 rounded-lg px-1.5 py-1 hover:bg-white/4', mine && 'bg-primary/8', !cont && 'mt-1.5 first:mt-0')}>
      {cont ? <span className="w-7 shrink-0" aria-hidden /> : <DriverAvatar name={m.name} image={m.image} className="size-7 shrink-0" />}
      <div className="min-w-0 flex-1">
        {!cont && (
          <p className="flex items-baseline gap-2 text-xs">
            <span className={cn('truncate font-semibold', mine ? 'text-primary' : 'text-foreground')}>{m.name}{mine && <span className="font-normal text-muted-foreground"> (you)</span>}</span>
            {muted && <span className="text-[0.7rem] text-amber-300">muted</span>}
            <time className="num shrink-0 text-muted-foreground" dateTime={new Date(m.at).toISOString()}>{hhmm(m.at)}</time>
          </p>
        )}
        <p className="text-sm break-words whitespace-pre-wrap">{m.text}</p>
      </div>
      {admin && (
        <div className="absolute top-0.5 right-1 flex gap-0.5 rounded-md bg-background/90 p-0.5 opacity-0 shadow transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button size="icon-xs" variant="ghost" title={muted ? `Let ${m.name} write again` : `Mute ${m.name} for ${MUTE_HOURS} h`} aria-label={muted ? `Unmute ${m.name}` : `Mute ${m.name}`}
            onClick={() => mute(muted ? 0 : MUTE_HOURS)}>{muted ? <Mic /> : <MicOff />}</Button>
          <Button size="icon-xs" variant="ghost" className="hover:text-destructive" title="Delete this message" aria-label="Delete this message"
            onClick={() => send({ t: 'chatDel', ch, id: m.id })}><Trash2 /></Button>
        </div>
      )}
    </li>
  );
}

/** the line to write on: Enter sends, Esc leaves (onEscape) */
export const ChatInput = forwardRef<HTMLInputElement, { ch: ChatChannel; onEscape?: () => void; onSent?: () => void; className?: string; placeholder?: string }>(
  function ChatInput({ ch, onEscape, onSent, className, placeholder }, ref) {
    const [text, setText] = useState('');
    const n = Array.from(text).length;
    const submit = (e: React.FormEvent) => {
      e.preventDefault();
      const t = text.trim();
      if (!t) { onSent?.(); return; }
      if (!sendChat(ch, t)) { toast.error('Not connected to the race server.'); return; }
      setText(''); onSent?.();
    };
    return (
      <form onSubmit={submit} className={cn('flex items-center gap-2', className)} aria-label={`Write to ${CHANNEL_NAME[ch]}`}>
        <div className="relative min-w-0 flex-1">
          <Input ref={ref} value={text} onChange={e => setText(Array.from(e.target.value).slice(0, CHAT_MAX).join(''))} autoComplete="off" enterKeyHint="send"
            onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); onEscape?.(); } e.stopPropagation(); }}
            placeholder={placeholder ?? (ch === 'main' ? 'Message everyone' : 'Message this race')} aria-label={`Message ${CHANNEL_NAME[ch]}`} className="h-10 pr-12" />
          {n > CHAT_MAX - 100 && <span className={cn('num pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs', n >= CHAT_MAX ? 'text-destructive' : 'text-muted-foreground')}>{CHAT_MAX - n}</span>}
        </div>
        <Button type="submit" size="icon-lg" aria-label="Send" title="Send (Enter)" disabled={!text.trim()}><SendHorizontal /></Button>
      </form>
    );
  });

/**
 * Over the race: each new message for SHOW_MS, the newest few; with `open`, the line to write on (to this race, or
 * everyone), which closes on Enter or Esc (onClose: back to the car).
 */
const SHOW_MS = 12_000;
export function ChatOverlay({ meId, open, onClose, className }: { meId?: string; open: boolean; onClose: () => void; className?: string }) {
  const [room] = useSubject(chat$.room);
  const [main] = useSubject(chat$.main);
  const [ch, setCh] = useState<ChatChannel>('room');
  const [now, setNow] = useState(() => Date.now());
  const input = useRef<HTMLInputElement>(null);
  // the messages that came while this page was here (not the history a join brings)
  const since = useRef(Date.now());
  const recent = useMemo(() => [...room.map(m => ({ m, ch: 'room' as const })), ...main.map(m => ({ m, ch: 'main' as const }))]
    .filter(({ m }) => m.at >= since.current - 1000 && (open || now - m.at < SHOW_MS)).sort((a, b) => a.m.at - b.m.at).slice(-6), [room, main, now, open]);
  useEffect(() => { if (!recent.length || open) return; const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [recent.length, open]);
  useEffect(() => { if (open) { setNow(Date.now()); input.current?.focus(); } }, [open]);
  if (!open && !recent.length) return null;
  return (
    <div className={cn('w-[min(380px,calc(100vw-24px))] space-y-1.5', className)}>
      <ol aria-live="polite" aria-label="Chat" className="pointer-events-none space-y-1">
        {recent.map(({ m, ch: c }) => (
          <li key={m.id} className={cn('w-fit max-w-full rounded-lg bg-black/55 px-2.5 py-1 text-sm text-white shadow backdrop-blur-sm transition-opacity duration-700', !open && now - m.at > SHOW_MS - 2000 && 'opacity-0')}>
            {c === 'main' && <span className="mr-1.5 text-[0.7rem] tracking-wide text-tnn uppercase">Everyone</span>}
            <span className={cn('font-semibold', m.uid === meId ? 'text-primary' : 'text-amber-200')}>{m.name}</span> <span className="break-words">{m.text}</span>
          </li>
        ))}
      </ol>
      {open && (
        <div className="rounded-xl border border-white/10 bg-background/85 p-2 shadow-xl backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between gap-2">
            <SegmentedControl aria-label="Write to" className="seg text-xs" value={ch} onValueChange={v => { if (v) { setCh(v as ChatChannel); input.current?.focus(); } }}>
              <SegmentedControlIndicator className="seg-indicator" />
              <SegmentedControlItem value="room" className="seg-item px-2 py-1">{CHANNEL_NAME.room}</SegmentedControlItem>
              <SegmentedControlItem value="main" className="seg-item px-2 py-1">{CHANNEL_NAME.main}</SegmentedControlItem>
            </SegmentedControl>
            <span className="text-xs text-muted-foreground">Enter sends · Esc drives</span>
          </div>
          <ChatInput ref={input} ch={ch} onEscape={onClose} onSent={onClose} />
        </div>
      )}
    </div>
  );
}
