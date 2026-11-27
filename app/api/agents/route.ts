import { agentStore, prettyCode } from '@/lib/agents/store.mjs';
import { caller, errorResponse, json, readBody } from '@/lib/agents/http';
import { siteUrl } from '@/lib/site-url';

export const dynamic = 'force-dynamic';

// POST { name }: an agent signs itself up (docs/agents.md). No sign-in: that is the point. It gets its key (once) and
// the link its human owner claims it with. Counted per address and overall (AGENT_LIMITS).
export async function POST(req: Request) {
  try {
    const b = await readBody(req), site = siteUrl(req.headers);
    const { agent, key, claim } = await agentStore().register({ name: b.name, from: caller(req) });
    const code = prettyCode(claim);
    return json({
      agent: { id: agent.id, name: agent.name },
      key,
      claim: { code, url: `${site}/agents/claim?code=${code}` },
      docs: `${site}/agents.md`,
      note: 'Keep the key: it is shown only now, and it is how you prove who you are (Authorization: Bearer <key>). Give the claim link to the person you work for: it makes this account theirs.',
    }, 201);
  } catch (e) { return errorResponse(e); }
}

export function GET(req: Request) {
  return json({ error: 'POST { "name": "..." } here to sign up as an agent.', docs: `${siteUrl(req.headers)}/agents.md` }, 405);
}
