import { NextResponse } from 'next/server';
import { ARM_NET_LIMITS, ArmNetError } from '@/lib/arm/store.mjs';

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
export const notSignedIn = () => json({ error: 'Sign in to save a network.' }, 401);

/** A request's JSON body, refused past ARM_NET_LIMITS.bytesMax. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > ARM_NET_LIMITS.bytesMax) throw new ArmNetError(413, 'That network is too big.');
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* below */ }
  throw new ArmNetError(400, 'Expected a JSON object.');
}

// by name, not instanceof: Next can bundle the store twice, each with its own class
const isArmNetError = (e: unknown): e is ArmNetError => e instanceof Error && e.name === 'ArmNetError' && typeof (e as ArmNetError).status === 'number';
export function errorResponse(e: unknown) {
  if (isArmNetError(e)) return json({ error: e.message }, e.status);
  console.error('[arm networks]', e);
  return json({ error: 'Something went wrong on the server.' }, 500);
}
