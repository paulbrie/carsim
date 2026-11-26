#!/usr/bin/env node
// The agent bridge, the agent's side (lib/bridge/store.mjs has the plan; public/sim/bridge.js, the page's):
//   node scripts/bridge.mjs claim <code> [name]    take the sim page showing that code (🤝 Agent → Connect)
//   node scripts/bridge.mjs status                 the page paired with
//   node scripts/bridge.mjs <command> [json args]  a command, e.g. state · screenshot '{"maxWidth":800}' (saved to a file)
//                                                  click '{"text":"Train"}' · key '{"code":"KeyI"}' · get '{"path":"ai.hist"}'
//   node scripts/bridge.mjs events [wait s]        the user's messages since the last look
//   node scripts/bridge.mjs pages                  the super admin's open sim pages (no code: the server's agent key, #348)
//   node scripts/bridge.mjs take [pageId]          take that page, or the newest connected one, without a code
// CARSIM_URL: the app (default http://localhost:7001/projects/carsim). The token is kept in ~/.carsim-bridge.json, one
// per app URL (#348: a claim on the deployed site no longer replaces the dev box's). The agent key: CLAUDE_BRIDGE_AGENT_KEY,
// or the repo's .env.local.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.env.CARSIM_URL || 'http://localhost:7001/projects/carsim').replace(/\/+$/, '');
const KEEP = path.join(os.homedir(), '.carsim-bridge.json');
// { byUrl: { <app url>: { agentToken, pageId, seq } } }; a token kept before that (at the top) still serves an app with none
const file = () => { try { return JSON.parse(fs.readFileSync(KEEP, 'utf8')); } catch { return {}; } };
const kept = () => { const f = file(); return f.byUrl?.[BASE] || { agentToken: f.agentToken, pageId: f.pageId, seq: f.seq }; };
const save = o => { const f = file(); f.byUrl = { ...f.byUrl, [BASE]: { ...kept(), ...o } }; fs.writeFileSync(KEEP, JSON.stringify(f), { mode: 0o600 }); };
function agentKey() {
  if (process.env.CLAUDE_BRIDGE_AGENT_KEY) return process.env.CLAUDE_BRIDGE_AGENT_KEY;
  try { return fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').match(/^CLAUDE_BRIDGE_AGENT_KEY=(.+)$/m)?.[1].trim() || ''; } catch { return ''; }
}

async function call(p, { method = 'GET', body, auth = true } = {}) {
  const r = await fetch(BASE + '/api/bridge/agent' + p, {
    method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(auth === 'key' ? { 'x-bridge-key': agentKey() } : auth ? { authorization: `Bearer ${kept().agentToken || ''}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok && !('ok' in b)) throw new Error(`${r.status}: ${b.error || r.statusText}`);
  return b;
}

const [cmd, a1, a2] = process.argv.slice(2);
try {
  if (!cmd) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 14).join('\n')); process.exit(0); }
  if (cmd === 'pages') {
    const r = await call('/pages', { auth: 'key' });
    for (const p of r.pages) console.log(`${p.pageId}  ${p.connected ? 'connected' : 'away    '}  ${p.agent ? 'with ' + p.agent : 'free'}  ${p.standing ? 'standing ' : ''}${new Date(p.lastSeen).toLocaleTimeString()}  ${p.url}`);
    if (!r.pages.length) console.log('(no sim page open for the super admin)');
    process.exit(0);
  }
  if (cmd === 'take') {
    const r = await call('/take', { method: 'POST', body: { pageId: a1 || '', agent: a2 || 'Claude' }, auth: 'key' });
    save({ agentToken: r.agentToken, pageId: r.pageId, seq: 0 });
    console.log(`took page ${r.pageId}`);
    process.exit(0);
  }
  if (cmd === 'claim') {
    const r = await call('/claim', { method: 'POST', body: { code: a1, agent: a2 || 'Claude' }, auth: false });
    save({ agentToken: r.agentToken, pageId: r.pageId, seq: 0 });
    console.log(`paired with page ${r.pageId}`);
  } else if (cmd === 'status') {
    console.log(JSON.stringify(await call('/status'), null, 2));
  } else if (cmd === 'events') {
    const r = await call(`/events?after=${kept().seq || 0}&wait=${Number(a1) || 0}`);
    save({ seq: r.seq });
    for (const e of r.events) console.log(`[${new Date(e.at).toLocaleTimeString()}] ${e.kind}: ${e.text ?? ''}`);
    if (!r.events.length) console.log('(nothing new)');
  } else {
    const r = await call('/command', { method: 'POST', body: { type: cmd, args: a1 ? JSON.parse(a1) : {} } });
    if (!r.ok) { console.error(`✕ ${r.error}`); process.exit(1); }
    const d = r.data || {};
    if (typeof d.dataUrl === 'string') {
      const [, ext, b64] = d.dataUrl.match(/^data:image\/(\w+);base64,(.*)$/) || [];
      const f = path.join(os.tmpdir(), `carsim-shot-${Date.now()}.${ext === 'jpeg' ? 'jpg' : ext}`);
      fs.writeFileSync(f, Buffer.from(b64, 'base64'));
      console.log(JSON.stringify({ ...d, dataUrl: undefined, file: f }, null, 2));
    } else console.log(JSON.stringify(d, null, 2));
  }
} catch (e) { console.error(`✕ ${e.message}`); process.exit(1); }
