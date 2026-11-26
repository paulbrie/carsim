// The agent bridge as an MCP server over HTTP (#355): /api/mcp (app/api/mcp/route.ts), the "Streamable HTTP" transport
// with plain JSON answers, so any agent that speaks MCP connects with the site's URL and nothing to install. The same
// tools as the stdio server (scripts/bridge-mcp.mjs: a test compares their names), on the same store.
//
// Who is who: `initialize` gives the client a session (Mcp-Session-Id, 192 random bits, which it sends back with every
// request); `sim_pair` claims the code a driver's page shows and makes that pairing the session's (kept with the
// pairing, so a restart doesn't end it). No cookies, no account: the session can do what the code's page lets an agent
// do, nothing else. An agent that already holds a token (scripts/bridge.mjs claim) may send it as a Bearer instead.
import crypto from 'node:crypto';
import { bridgeReady, BridgeError } from './store.mjs';

export const MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const mcpSession = () => crypto.randomBytes(24).toString('base64url');
const SESSION = /^[A-Za-z0-9_-]{32,64}$/;

const COMMANDS = `The page's commands (sim_command { type, args }):
- state {} : the sim at a glance (car, lap, autopilot, race, what the panels say)
- text { selector?, max? } : what an element shows (the page by default)
- click { selector | text, nth? } : a button, a checkbox, a summary, by CSS selector or by its text
- set { selector, value } : an input's value, or a checkbox ticked
- key { code, ms? } : a key pressed and held ms (KeyW, KeyA, KeyS, KeyD or the arrows drive; KeyI opens the TNN lab; KeyR respawns)
- get { path, slice?, pick? } : a value of the sim's window.__sim, read only (e.g. "ai.hist", "lap.best", "VEH.key")
- sim { fn, args? } : one of a few of the sim's functions (restartRun, respawn, switchVehicle, setSurface, placeAtGate, step, aiTrainSync, aiTry, aiDrive, aiDemo, aiSaveServer, repairCar, startReplay, stopReplay...)
- reload {} · goto { path } : the page again, or another of the sim's pages
No arbitrary JavaScript. The driver sees every command in the bridge's panel, and can disconnect at any time.`;

export const MCP_INSTRUCTIONS = `Carsim: work in a driver's own simulator page, in their browser, where they see what you do.
To start, ask the driver for a pairing code: in the sim (a race room on the site), "Agent" in the rail on the right, then Connect; it shows a code like K7QF-2M9X, valid 10 minutes. Call sim_pair with it. After that: sim_state for where things stand, sim_screenshot for the 3D view, sim_command to act, sim_events for what the driver writes to you.
${COMMANDS}
To run the physics yourself, without a browser, download the simulator as a module instead: see /developers.md on this site.`;

const text = s => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] });
const NOT_PAIRED = 'Not paired yet: ask the driver for the code their sim shows (Agent → Connect), then call sim_pair with it.';

/** the tools: name → { description, inputSchema, run(args, ctx) } (ctx: { br, token, session, who }) */
export const MCP_TOOLS = {
  sim_pair: {
    description: 'Pair with the sim page showing this code (the driver: Agent → Connect, in the sim; 8 characters like K7QF-2M9X, valid 10 minutes).',
    inputSchema: { type: 'object', properties: { code: { type: 'string' }, name: { type: 'string', description: 'your name, shown to the driver' } }, required: ['code'] },
    open: true,
    async run({ code, name }, c) {
      if (!c.session) throw new BridgeError(400, 'This MCP client sent no session (Mcp-Session-Id): initialize first, and send the header the answer gave.');
      const r = c.br.claim(code, name || c.client || 'Agent', c.who);
      c.br.bindSession(r.agentToken, c.session);
      return text(`Paired with page ${r.pageId}. sim_state says where things stand.`);
    },
  },
  sim_status: { description: 'The page paired with: its URL, title, whether it is connected.', inputSchema: { type: 'object', properties: {} }, run: async (a, c) => text(c.br.status(c.token)) },
  sim_state: { description: 'The sim at a glance: the car, the lap, the autopilot (training, generations, best lap, last exam), the race, what the panels say.', inputSchema: { type: 'object', properties: {} }, run: async (a, c) => text(await command(c, 'state')) },
  sim_screenshot: {
    description: 'A picture of the 3D view as drawn (not the HTML panels over it). The tab must be in front.',
    inputSchema: { type: 'object', properties: { maxWidth: { type: 'number' } } },
    async run({ maxWidth = 900 }, c) {
      const d = await command(c, 'screenshot', { maxWidth: Math.max(160, Math.min(1600, Number(maxWidth) || 900)) }), m = String(d?.dataUrl || '').match(/^data:(image\/\w+);base64,(.*)$/);
      if (!m) throw new BridgeError(502, 'The page sent no picture.');
      return { content: [{ type: 'image', data: m[2], mimeType: m[1] }] };
    },
  },
  sim_command: {
    description: `Any of the page's commands. ${COMMANDS}`,
    inputSchema: { type: 'object', properties: { type: { type: 'string' }, args: { type: 'object' } }, required: ['type'] },
    run: async ({ type, args }, c) => text(await command(c, type, args && typeof args === 'object' ? args : {})),
  },
  sim_events: {
    description: 'What the driver wrote in the bridge panel since the last look, waiting up to `wait` seconds (25 at most) for something.',
    inputSchema: { type: 'object', properties: { wait: { type: 'number' } } },
    quiet: true,
    async run({ wait = 0 }, c) {
      const ev = await c.br.sessionEvents(c.token, Math.max(0, Math.min(25, Number(wait) || 0)) * 1000);
      return text(ev.length ? ev.map(e => `[${new Date(e.at).toISOString().slice(11, 19)}] ${e.text}`).join('\n') : '(nothing new)');
    },
  },
};
async function command(c, type, args = {}) {
  const r = await c.br.command(c.token, { type, args });
  if (!r.ok) throw new BridgeError(r.timeout ? 504 : 502, r.error || 'failed');
  return r.data;
}

/**
 * One JSON-RPC message → its answer (null: a notification, nothing to say), and the session to give the client
 * (initialize). ctx: { session, bearer, who }.
 */
export async function mcpHandle(m, ctx = {}) {
  const id = m?.id, ok = result => ({ answer: { jsonrpc: '2.0', id, result } }), fail = (code, message) => ({ answer: { jsonrpc: '2.0', id: id ?? null, error: { code, message } } });
  if (!m || typeof m !== 'object' || Array.isArray(m) || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return id === undefined && m && typeof m === 'object' && ('result' in m || 'error' in m) ? { answer: null } : fail(-32600, 'Not a JSON-RPC 2.0 request.');
  if (id === undefined || id === null) return { answer: null };          // a notification (notifications/initialized...)
  const session = SESSION.test(ctx.session || '') ? ctx.session : '';
  switch (m.method) {
    case 'initialize': {
      const want = m.params?.protocolVersion, s = session || mcpSession();
      return { ...ok({ protocolVersion: MCP_VERSIONS.includes(want) ? want : MCP_VERSIONS[0], capabilities: { tools: {} }, serverInfo: { name: 'carsim', title: 'Carsim simulator', version: '1.0.0' }, instructions: MCP_INSTRUCTIONS }), session: s };
    }
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: Object.entries(MCP_TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const t = Object.hasOwn(MCP_TOOLS, m.params?.name) ? MCP_TOOLS[m.params.name] : null;
      if (!t) return fail(-32602, `No tool ${String(m.params?.name).slice(0, 60)}`);
      const a = m.params.arguments && typeof m.params.arguments === 'object' ? m.params.arguments : {};
      try {
        const br = await bridgeReady(), token = ctx.bearer || br.sessionToken(session);
        if (!t.open && !token) return ok({ content: [{ type: 'text', text: NOT_PAIRED }], isError: true });
        const c = { br, token, session, who: ctx.who || '', client: ctx.client || '' }, res = await t.run(a, c);
        if (!t.open && !t.quiet) {                                      // what the driver wrote meanwhile, after any tool's answer
          const ev = await br.sessionEvents(token, 0).catch(() => []);
          if (ev.length) res.content.push({ type: 'text', text: 'Meanwhile, from the driver:\n' + ev.map(e => `- ${e.text}`).join('\n') });
        }
        return ok(res);
      } catch (e) {
        if (e?.name !== 'BridgeError') { console.error('[mcp]', e); return ok({ content: [{ type: 'text', text: 'Something went wrong on the server.' }], isError: true }); }
        return ok({ content: [{ type: 'text', text: e.status === 401 ? NOT_PAIRED : e.message }], isError: true });
      }
    }
    default: return fail(-32601, `No method ${m.method.slice(0, 60)}`);
  }
}
