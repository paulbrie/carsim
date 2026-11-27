import { agentStore, prettyCode } from '@/lib/agents/store.mjs';
import { agentAuth, errorResponse, json } from '@/lib/agents/http';
import { siteUrl } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

// POST: a new claim link for an agent nobody has claimed yet (the first one lost); the old one stops working.
export async function POST(req: Request) {
  try {
    const a = await agentAuth(req);
    const { claim } = await agentStore().newClaim(a.id, { agent: a.id });
    const code = prettyCode(claim);
    return json({ claim: { code, url: `${siteUrl(req.headers)}/agents/claim?code=${code}` } });
  } catch (e) { return errorResponse(e); }
}
