import { NextResponse } from 'next/server';
import { MAP_LIMITS, MapError } from '@/lib/maps/store.mjs';

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

/** A request's JSON body, refused past MAP_LIMITS.bytesMax (a course with many terrain strokes runs to a few MB). */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAP_LIMITS.bytesMax) throw new MapError(413, 'That course is too big.');
  const text = await req.text();
  if (text.length > MAP_LIMITS.bytesMax) throw new MapError(413, 'That course is too big.');
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch { /* below */ }
  throw new MapError(400, 'Expected a JSON object.');
}

// by name, not instanceof: Next can bundle the store twice (route and page), each with its own class
const isMapError = (e: unknown): e is MapError => e instanceof Error && e.name === 'MapError' && typeof (e as MapError).status === 'number';

export function errorResponse(e: unknown) {
  if (isMapError(e)) return json({ error: e.message }, e.status);
  console.error('[maps]', e);
  return json({ error: 'Something went wrong on the server.' }, 500);
}

export const notSignedIn = () => json({ error: 'Sign in first.' }, 401);
export const notAdmin = () => json({ error: 'Only the super admin can change the maps.' }, 403);
