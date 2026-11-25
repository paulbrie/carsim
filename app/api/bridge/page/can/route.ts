import { adminSession } from '@/auth';
import { json } from '@/lib/bridge/http';
import { bridgeAgentKey, bridgeOn } from '@/lib/bridge/store.mjs';

export const dynamic = 'force-dynamic';
// GET: may this user pair the sim with Claude (the super admin only, unless CLAUDE_BRIDGE=off: bridgeOn)? The sim shows its
// 🤝 button if so. standing: an agent with the server's key may take the page without a code (#348): it pairs by itself.
export async function GET() {
  const can = bridgeOn() && !!(await adminSession());
  return json({ can, standing: can && !!bridgeAgentKey() });
}
