// One Node process for Railway (or anywhere): the Next.js app, the race WebSocket at /ws,
// and a health check at /api/health, all on $PORT.
//   npm run dev     development (Next dev server, HMR)
//   npm start       production (after npm run build)
import { watchFile } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import next from 'next';
import nextEnv from '@next/env';
import { WebSocketServer } from 'ws';
import { RaceHub } from './lib/race/hub.mjs';
import { LIMITS } from './lib/race/shared.mjs';
import { verifyTicket } from './lib/race/ticket.mjs';
import { mapStore } from './lib/maps/store.mjs';
import { recordStore } from './lib/race/records.mjs';

const dev = process.env.NODE_ENV !== 'production';
nextEnv.loadEnvConfig(process.cwd(), dev);        // .env*, as next dev / next start would, before reading AUTH_SECRET
const port = Number(process.env.PORT) || 7001;
// not $HOSTNAME: containers set it to their own name
const hostname = process.env.HOST || '0.0.0.0';
const base = (process.env.BASE_PATH || '').replace(/\/+$/, '');   // e.g. /projects/carsim, see next.config.ts
const secret = process.env.AUTH_SECRET;
if (!secret) console.warn('[carsim] AUTH_SECRET is not set: sign-in and the race server will refuse everyone');

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();
await app.prepare();
const nextUpgrade = app.getUpgradeHandler();

const records = recordStore();
const hub = new RaceHub({ maps: mapStore(), records });
const started = Date.now();
// In development the lists of cars, grounds and weathers are read again when shared.mjs changes: this process
// outlives many edits, and a car added since it started was one the lobby showed and a room ignored (#313).
// (Polled: an editor or git replaces the file, which loses a watch on it. Other changes there, and to the hub
// itself, still need a restart.)
if (dev) {
  const sharedUrl = new URL('./lib/race/shared.mjs', import.meta.url);
  watchFile(fileURLToPath(sharedUrl), { interval: 2000 }, async now => {
    if (!now.mtimeMs) return;                                  // gone for a moment (a checkout)
    try {
      const m = await import(`${sharedUrl.href}?v=${now.mtimeMs}`);
      hub.setLists({ vehicles: m.VEHICLE_KEYS, grounds: m.GROUND_KEYS, weathers: m.WEATHER_KEYS });
      console.log(`[carsim] shared.mjs changed: ${hub.lists.vehicles.length} cars, ${hub.lists.grounds.length} grounds, ${hub.lists.weathers.length} weathers`);
    } catch (e) { console.warn('[carsim] shared.mjs changed but could not be read again:', e?.message ?? e); }
  });
}
// maxPayload: a best lap's path (#310) is the biggest message
const wss = new WebSocketServer({ noServer: true, maxPayload: 80 * 1024, perMessageDeflate: false });

const server = createServer((req, res) => {
  if (req.url === `${base}/api/health`) {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, uptime: Math.round((Date.now() - started) / 1000), rooms: hub.rooms.size, clients: hub.clients.size }));
    return;
  }
  handle(req, res);
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname !== `${base}/ws`) return nextUpgrade(req, socket, head);   // Next's own (HMR in dev)
  // same-origin pages only (the ticket is the real check; this stops other sites riding on one)
  const origin = req.headers.origin, host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origin && host && new URL(origin).host !== String(host).split(',')[0].trim()) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  const user = verifyTicket(url.searchParams.get('ticket'), secret);
  if (!user) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
  wss.handleUpgrade(req, socket, head, ws => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const client = hub.connect(user, msg => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); });
    ws.on('message', data => {
      let msg; try { msg = JSON.parse(String(data)); } catch { return; }
      client.message(msg);
    });
    ws.on('close', () => client.close());
    ws.on('error', () => client.close());
  });
});

// race clock and position relay
const tick = setInterval(() => hub.tick(), LIMITS.tickMs);
// keep connections alive through proxies (Railway's edge drops idle ones) and drop dead ones
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
}, 25_000);

server.listen(port, hostname, () => console.log(`[carsim] ${dev ? 'dev' : 'production'} on http://${hostname}:${port}${base}`));

// Railway sends SIGTERM on redeploy: tell the browsers to reconnect, then exit
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  if (stopping) return; stopping = true;
  clearInterval(tick); clearInterval(heartbeat);
  records.flush();
  for (const ws of wss.clients) ws.close(1012, 'server restarting');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
