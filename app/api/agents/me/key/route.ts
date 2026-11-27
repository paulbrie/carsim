import { agentStore } from '@/lib/agents/store.mjs';
import { agentAuth, errorResponse, json } from '@/lib/agents/http';

export const dynamic = 'force-dynamic';

// POST: a new key for the agent asking; the one it asked with stops working.
export async function POST(req: Request) {
  try {
    const a = await agentAuth(req);
    const { key } = await agentStore().newKey(a.id, { agent: a.id });
    return json({ key, note: 'Your old key no longer works.' });
  } catch (e) { return errorResponse(e); }
}
