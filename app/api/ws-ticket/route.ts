import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { issueTicket } from '@/lib/race/ticket.mjs';

export const dynamic = 'force-dynamic';

// A one-minute pass for the race WebSocket (/ws, handled by server.mjs), for the signed-in user (and whether they are
// the super admin, who moderates the chat: #325).
export async function GET() {
  const session = await auth();
  const u = session?.user;
  if (!u?.id) return NextResponse.json({ error: 'not signed in' }, { status: 401 });
  const ticket = issueTicket({ id: u.id, name: u.name || 'Driver', image: u.image || null, admin: u.admin === true }, process.env.AUTH_SECRET || '');
  return NextResponse.json({ ticket }, { headers: { 'cache-control': 'no-store' } });
}
