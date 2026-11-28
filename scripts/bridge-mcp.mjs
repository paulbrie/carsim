#!/usr/bin/env node
// The agent bridge as an MCP server over stdio (as trafficsim's scripts/claude-bridge-mcp.ts, cut to the sim): an agent's
// tools for working in a driver's own sim page (public/sim/bridge.js carries the commands out there;
// lib/bridge/store.mjs relays them). Same HTTP API and token file (~/.carsim-bridge.json) as scripts/bridge.mjs.
// .mcp.json starts it for Claude Code in this project. CARSIM_URL: the app (default http://localhost:7001/projects/carsim).
// One file, nothing to install (Node 18+): the site serves it for download (/carsim-mcp.mjs, with its own URL as the
// default), for agents that take a command rather than a URL. The same tools over HTTP: /api/mcp (lib/bridge/mcp.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const BASE = (process.env.CARSIM_URL || 'http://localhost:7001/projects/carsim').replace(/\/+$/, '');
const KEEP = path.join(os.homedir(), '.carsim-bridge.json');
// one token per app URL, as scripts/bridge.mjs keeps them (#348); a token kept before that (at the top) serves an app with none
const file = () => { try { return JSON.parse(fs.readFileSync(KEEP, 'utf8')); } catch { return {}; } };
const kept = () => { const f = file(); return f.byUrl?.[BASE] || { agentToken: f.agentToken, pageId: f.pageId, seq: f.seq }; };
const save = o => { const f = file(); f.byUrl = { ...f.byUrl, [BASE]: { ...kept(), ...o } }; fs.writeFileSync(KEEP, JSON.stringify(f), { mode: 0o600 }); };

async function call(p, { method = 'GET', body, auth = true } = {}) {
  const r = await fetch(BASE + '/api/bridge/agent' + p, {
    method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: `Bearer ${kept().agentToken || ''}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok && !('ok' in b)) throw new Error(b.error || `${r.status} ${r.statusText}`);
  return b;
}
async function command(type, args = {}) {
  const r = await call('/command', { method: 'POST', body: { type, args } });
  if (!r.ok) throw new Error(r.error || 'failed');
  return r.data;
}
// what the user wrote meanwhile, after any tool's answer
async function meanwhile() {
  try {
    const r = await call(`/events?after=${kept().seq || 0}&wait=0`); save({ seq: r.seq });
    return r.events.length ? '\n\nMeanwhile, from the page:\n' + r.events.map(e => `- ${e.text}`).join('\n') : '';
  } catch { return ''; }
}

const text = s => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] });
const TOOLS = {
  sim_pair: {
    description: 'Pair with the sim page showing this code (the driver: Agent → Connect, in the sim; 8 characters like K7QF-2M9X, valid 10 minutes).',
    inputSchema: { type: 'object', properties: { code: { type: 'string' }, name: { type: 'string', description: 'your name, shown to the user' } }, required: ['code'] },
    run: async ({ code, name }) => { const r = await call('/claim', { method: 'POST', body: { code, agent: name || 'Claude' }, auth: false }); save({ agentToken: r.agentToken, pageId: r.pageId, seq: 0 }); return text(`Paired with page ${r.pageId}.`); },
  },
  sim_status: { description: 'The page paired with: its URL, title, whether it is connected.', inputSchema: { type: 'object', properties: {} }, run: async () => text(await call('/status')) },
  sim_state: { description: 'The sim at a glance: the car, the lap, the autopilot (training, generations, best lap, last exam), the race, what the panels say.', inputSchema: { type: 'object', properties: {} }, run: async () => text(await command('state')) },
  sim_screenshot: {
    description: 'A picture of the 3D view as drawn (not the HTML panels over it). The tab must be in front.',
    inputSchema: { type: 'object', properties: { maxWidth: { type: 'number' } } },
    run: async ({ maxWidth = 900 }) => { const d = await command('screenshot', { maxWidth }); const [, mime, b64] = d.dataUrl.match(/^data:(image\/\w+);base64,(.*)$/); return { content: [{ type: 'image', data: b64, mimeType: mime }] }; },
  },
  sim_command: {
    description: 'Any of the page\'s commands: text {selector?}, click {selector | text, nth?}, set {selector, value}, key {code, ms?}, get {path, slice?, pick?} (window.__sim, read only), sim {fn, args} (a few of window.__sim\'s functions: restartRun, switchVehicle, setSurface, aiTrainSync, aiTry, aiDrive, aiDemo, …), reload; on the arm sim\'s page (/arm) arm {fn, args} (arm, task, scenario, mode, config, train, stop, history, exam, net, load, place, speed, pause). See public/sim/bridge.js.',
    inputSchema: { type: 'object', properties: { type: { type: 'string' }, args: { type: 'object' } }, required: ['type'] },
    run: async ({ type, args }) => text(await command(type, args || {})),
  },
  sim_events: {
    description: 'What the user wrote in the bridge panel since the last look, waiting up to `wait` seconds (25 at most) for something.',
    inputSchema: { type: 'object', properties: { wait: { type: 'number' } } },
    run: async ({ wait = 0 }) => { const r = await call(`/events?after=${kept().seq || 0}&wait=${Math.min(25, wait)}`); save({ seq: r.seq }); return text(r.events.length ? r.events.map(e => `[${new Date(e.at).toLocaleTimeString()}] ${e.text}`).join('\n') : '(nothing new)'); },
  },
};

const send = m => process.stdout.write(JSON.stringify(m) + '\n');
createInterface({ input: process.stdin }).on('line', async line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  const { id, method, params } = m;
  if (id === undefined) return;                                            // a notification
  try {
    if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'carsim-sim', version: '1.0.0' } } });
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) } });
    if (method === 'tools/call') {
      const t = TOOLS[params?.name];
      if (!t) return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `No tool ${params?.name}` } });
      let res;
      try { res = await t.run(params.arguments || {}); if (params.name !== 'sim_events' && params.name !== 'sim_pair') { const more = await meanwhile(); if (more) res.content.push({ type: 'text', text: more }); } }
      catch (e) { res = { content: [{ type: 'text', text: `✕ ${e.message}` }], isError: true }; }
      return send({ jsonrpc: '2.0', id, result: res });
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `No method ${method}` } });
  } catch (e) { send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } }); }
});
