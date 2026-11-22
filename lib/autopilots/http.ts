import { NextResponse } from 'next/server';
import { AUTOPILOT_LIMITS, AutopilotError } from '@/lib/autopilots/store.mjs';

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
export const notSignedIn = () => json({ error: 'Sign in to the app first.' }, 401);

/** A request's JSON body, refused past AUTOPILOT_LIMITS.bytesMax. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > AUTOPILOT_LIMITS.bytesMax) throw new AutopilotError(413, 'That training is too big.');
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* below */ }
  throw new AutopilotError(400, 'Expected a JSON object.');
}

// by name, not instanceof: Next can bundle the store twice, each with its own class
const isAutopilotError = (e: unknown): e is AutopilotError => e instanceof Error && e.name === 'AutopilotError' && typeof (e as AutopilotError).status === 'number';
export function errorResponse(e: unknown) {
  if (isAutopilotError(e)) return json({ error: e.message }, e.status);
  console.error('[autopilots]', e);
  return json({ error: 'Something went wrong on the server.' }, 500);
}
