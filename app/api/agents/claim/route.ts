import { auth } from '@/auth';
import { agentStore } from '@/lib/agents/store.mjs';
import { agentView, errorResponse, json, readBody } from '@/lib/agents/http';
import { showcase } from '@/lib/showcase/store.mjs';

export const dynamic = 'force-dynamic';

// POST { code }: the signed-in user makes the agent with that claim code theirs (the page: /agents/claim).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return json({ error: 'Sign in to claim an agent.' }, 401);
  try {
    const b = await readBody(req);
    const a = await agentStore().claim(b.code, { id: session.user.id, name: session.user.name ?? null });
    showcase().forget();
    return json({ agent: agentView(a) });
  } catch (e) { return errorResponse(e); }
}
