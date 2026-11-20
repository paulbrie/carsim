// A scripted remote driver, for trying the multiplayer side without a second browser:
// it signs a ticket with AUTH_SECRET, joins a room, gets ready, and drives the figure-8
// (scripts/track-figure8.json: the course sampled every metre, with ground heights, from the sim)
// at a steady speed, reporting positions, laps and its finish like a browser would.
//   node scripts/bot-driver.mjs <ROOM> [name] [vehicle] [speed m/s] [url]
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import WebSocket from 'ws';
import { issueTicket } from '../lib/race/ticket.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(root, true);
const [room, name = 'Robo Racer', vehicle = 'rs6', speedArg = '16', base = 'http://localhost:3100'] = process.argv.slice(2);
if (!room) { console.error('usage: node scripts/bot-driver.mjs <ROOM> [name] [vehicle] [speed m/s] [url]'); process.exit(1); }
const speed = Number(speedArg);
const track = JSON.parse(readFileSync(join(root, 'scripts/track-figure8.json'), 'utf8'));
const P = track.pts, n = P.length, len = track.len, ds = len / n;
// the sample nearest the start gate
let s0 = 0, bd = Infinity;
P.forEach((p, i) => { const d = (p[0] - track.gate0[0]) ** 2 + (p[2] - track.gate0[1]) ** 2; if (d < bd) { bd = d; s0 = i * ds; } });

const at = s => {
  const f = (((s % len) + len) % len) / ds, i = Math.floor(f) % n, a = P[i], b = P[(i + 1) % n], t = f - Math.floor(f);
  const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
  const yaw = Math.atan2(b[0] - a[0], b[2] - a[2]);
  return { x, y, z, yaw };
};

const id = `bot:${name.toLowerCase().replace(/\W+/g, '-')}`;
const ticket = issueTicket({ id, name, image: null }, process.env.AUTH_SECRET);
const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?ticket=${encodeURIComponent(ticket)}`, { origin: base });
const send = m => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));

let phase = 'lobby', race = 0, laps = 3, slot = 0, s = s0 - 30, lap = 0, raceT = 0, lapT = 0, finished = false, me = null;
ws.on('open', () => { send({ t: 'join', room }); console.log(`[${name}] connected, joining ${room}`); });
ws.on('close', (c) => { console.log(`[${name}] closed ${c}`); process.exit(0); });
ws.on('message', data => {
  const m = JSON.parse(String(data));
  if (m.t === 'hello') me = m.me.id;
  if (m.t === 'error') console.log(`[${name}] error: ${m.msg}`);
  if (m.t !== 'room') return;
  const r = m.room, mine = r.players.find(p => p.id === me);
  if (!mine) return;
  if (mine.vehicle !== vehicle && (r.phase === 'lobby' || r.phase === 'results')) send({ t: 'car', vehicle, paint: '#4a90c8' });
  if (r.phase === 'lobby' && !mine.ready) send({ t: 'ready', ready: true });
  if (r.phase !== phase) console.log(`[${name}] ${r.phase}${r.phase === 'results' ? ' ' + JSON.stringify(r.results.map(x => [x.pos, x.name, x.total])) : ''}`);
  if ((r.phase === 'countdown' || r.phase === 'racing') && r.race !== race) {
    race = r.race; laps = r.laps; slot = mine.slot; finished = false; lap = 0; raceT = 0;
    s = s0 - (9 + (slot >> 1) * 8 + (slot % 2) * 3);
  }
  phase = r.phase;
});

const DT = 0.05;
setInterval(() => {
  const go = phase === 'racing' || phase === 'lobby' || phase === 'results';
  const v = go ? (phase === 'racing' ? speed : speed * 0.5) : 0;
  const before = s;
  s += v * DT;
  if (phase === 'racing' && !finished) {
    raceT += DT; lapT += DT;
    // over the start line
    if (Math.floor((before - s0) / len) !== Math.floor((s - s0) / len)) {
      if (lap >= 1) {
        send({ t: 'lap', lap, time: lapT, valid: true }); console.log(`[${name}] lap ${lap} ${lapT.toFixed(2)} s`);
        if (lap >= laps) { finished = true; send({ t: 'finish', time: raceT, missed: 0 }); console.log(`[${name}] finished ${raceT.toFixed(2)} s`); }
      }
      lap++; lapT = 0;
    }
  }
  const p = at(s), slotLat = (slot % 2 ? 1 : -1) * 2.2, nx = -Math.cos(p.yaw), nz = Math.sin(p.yaw);
  const x = p.x + nx * slotLat, z = p.z + nz * slotLat;
  const q = [0, Math.sin(p.yaw / 2), 0, Math.cos(p.yaw / 2)];
  const prog = lap ? (lap - 1) * len + (((s - s0) % len) + len) % len : (s - s0);
  send({ t: 's', p: [x, p.y + 0.75, z], q, v, st: 0, sp: v / 0.36, prog, lap });
}, DT * 1000);
