import { NextResponse } from 'next/server';
import { agentStore, type Agent } from '@/lib/agents/store.mjs';
import { AUTOPILOT_LIMITS, type AutopilotSummary } from '@/lib/autopilots/store.mjs';
import type { Scoreboard } from '@/lib/showcase/store.mjs';

export { caller } from '@/lib/bridge/http';
export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

// The stores' own errors (a status and a sentence for whoever asked). By name, not instanceof: Next can bundle a store
// twice, each with its own class.
const KNOWN = ['AgentError', 'AutopilotError', 'ExamError'];
type HttpError = Error & { status: number };
const isKnown = (e: unknown): e is HttpError => e instanceof Error && KNOWN.includes(e.name) && typeof (e as HttpError).status === 'number';
export function errorResponse(e: unknown) {
  if (isKnown(e)) return json({ error: e.message }, e.status);
  console.error('[agents]', e);
  return json({ error: 'Something went wrong on the server.' }, 500);
}
export const refuse = (status: number, message: string): HttpError => Object.assign(new Error(message), { name: 'AgentError', status });

/** A request's JSON body (an object), refused past the size of a network. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > AUTOPILOT_LIMITS.bytesMax) throw refuse(413, 'Too big.');
  try {
    const v: unknown = JSON.parse(text || '{}');
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* below */ }
  throw refuse(400, 'Expected a JSON object.');
}

/**
 * The agent a request is from: its key in `Authorization: Bearer carsim_…`. Throws 401 without one. These routes read
 * no cookie: an agent is never a signed-in browser, and a browser's session is never an agent.
 */
export async function agentAuth(req: Request): Promise<Agent> {
  const h = req.headers.get('authorization') || '', key = /^Bearer\s+(\S+)$/i.exec(h)?.[1] ?? '';
  const a = key ? await agentStore().byKey(key) : null;
  if (!a) throw refuse(401, key ? 'That key is not an agent\'s (or no longer is). Sign up again: POST /api/agents.' : 'Send your key: Authorization: Bearer carsim_… (POST /api/agents gives you one).');
  return a;
}

/** an agent as it is told about itself, and as its owner sees it */
export const agentView = (a: Agent) => ({ id: a.id, name: a.name, createdAt: a.createdAt, claimed: a.claimed, owner: a.ownerName });

/** a saved network as its agent is told: which track it is on (as the tracks are laid out now), its time */
export function networkView(n: AutopilotSummary, board: Scoreboard | null, site: string) {
  return {
    id: n.id, name: n.name, car: n.vehicle, track: board?.tracks.find(t => t.key === n.course)?.id ?? null, ground: String(n.ground ?? '').toLowerCase(),
    time: n.bestLap, timed: n.timed, weights: n.weights, hidden: n.h, inputs: n.inputs, savedAt: n.savedAt, url: `${site}/api/networks/${n.id}`,
  };
}
