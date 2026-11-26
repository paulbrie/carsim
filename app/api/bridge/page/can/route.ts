import { auth } from '@/auth';
import { json } from '@/lib/bridge/http';
import { bridgeAgentKey, bridgeOn } from '@/lib/bridge/store.mjs';

export const dynamic = 'force-dynamic';
// GET: may this user pair the sim with an agent (anyone signed in, #355, unless CLAUDE_BRIDGE=off: bridgeOn)? The sim shows
// its 🤝 button if so. standing: an agent with the server's key may take the page without a code (#348): it pairs by
// itself. The super admin's pages only.
export async function GET() {
  const s = bridgeOn() ? await auth() : null, can = !!s?.user?.id;
  return json({ can, standing: can && !!s?.user?.admin && !!bridgeAgentKey() });
}
