import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { BridgeError } from '@/lib/bridge/store.mjs';

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

// by name, not instanceof: Next can bundle the store twice, each with its own class
const isBridgeError = (e: unknown): e is BridgeError => e instanceof Error && e.name === 'BridgeError' && typeof (e as BridgeError).status === 'number';
export function errorResponse(e: unknown) {
  if (isBridgeError(e)) return json({ error: e.message }, e.status);
  console.error('[bridge]', e);
  return json({ error: 'Something went wrong on the server.' }, 500);
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  const t = await req.text();
  if (t.length > 4 * 1024 * 1024) throw new BridgeError(413, 'Too big.');      // a screenshot is the biggest
  try { const v: unknown = JSON.parse(t || '{}'); if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>; } catch { /* below */ }
  throw new BridgeError(400, 'Expected a JSON object.');
}

/**
 * the page side: a signed-in driver's session (#355: anyone's; admin: the super admin's, whose pages alone a keyed agent
 * takes without a code), and the pairing's own token (header x-bridge-page). The pairing is that user's: the store checks.
 */
export async function pageAuth(req: Request) {
  const s = await auth();
  if (!s?.user?.id) throw new BridgeError(403, 'Sign in to pair the sim with an agent.');
  return { user: s.user.id, admin: !!s.user.admin, pageToken: req.headers.get('x-bridge-page') || '' };
}

/**
 * who is calling an open route (claiming a code, the MCP endpoint): the address the proxy in front saw (nginx on the
 * box, Railway's edge: the last of x-forwarded-for is theirs, what comes before it the caller's own word), for the
 * per-caller count of wrong codes. Not an identity: only a bucket.
 */
export function caller(req: Request) {
  const real = req.headers.get('x-real-ip'), fwd = (req.headers.get('x-forwarded-for') || '').split(',').map(s => s.trim()).filter(Boolean);
  return (real || fwd.at(-1) || 'direct').slice(0, 80);
}

/** the agent side: Authorization: Bearer <agentToken> */
export function agentToken(req: Request) {
  const h = req.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}
