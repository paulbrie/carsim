import { bridgeReady } from '@/lib/bridge/store.mjs';
import { agentToken, errorResponse, json } from '@/lib/bridge/http';

export const dynamic = 'force-dynamic';
// GET: the page paired with: { page: { url, title, connected }, pairedAt }.
export async function GET(req: Request) {
  try { return json((await bridgeReady()).status(agentToken(req))); } catch (e) { return errorResponse(e); }
}
