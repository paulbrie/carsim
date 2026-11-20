// A short-lived signed ticket that lets a signed-in browser open the race WebSocket:
// /api/ws-ticket (behind Auth.js) issues it, server.mjs checks it on the upgrade.
// HMAC-SHA256 over the payload with AUTH_SECRET; no state on the server.
import { createHmac, timingSafeEqual } from 'node:crypto';

const b64 = buf => Buffer.from(buf).toString('base64url');
const sign = (data, secret) => createHmac('sha256', secret).update(data).digest('base64url');

/**
 * @param {{ id: string, name: string, image?: string | null }} user
 * @param {string} secret
 * @param {number} [ttlMs]
 * @param {number} [now]
 */
export function issueTicket(user, secret, ttlMs = 60_000, now = Date.now()) {
  if (!secret) throw new Error('AUTH_SECRET is not set');
  const body = b64(JSON.stringify({ id: user.id, name: user.name, image: user.image || null, exp: now + ttlMs }));
  return `${body}.${sign(body, secret)}`;
}

/** @returns {{ id: string, name: string, image: string | null } | null} */
export function verifyTicket(ticket, secret, now = Date.now()) {
  if (!secret || typeof ticket !== 'string') return null;
  const [body, mac] = ticket.split('.');
  if (!body || !mac) return null;
  const want = Buffer.from(sign(body, secret)), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof p.exp !== 'number' || p.exp < now || typeof p.id !== 'string' || !p.id) return null;
    return { id: p.id, name: typeof p.name === 'string' && p.name ? p.name : 'Driver', image: typeof p.image === 'string' ? p.image : null };
  } catch { return null; }
}
