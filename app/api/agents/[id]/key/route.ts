import { auth } from '@/auth';
import { agentStore } from '@/lib/agents/store.mjs';
import { errorResponse, json } from '@/lib/agents/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// POST: whoever claimed the agent gives it a new key (shown once, here); the old one stops working.
export async function POST(_req: Request, { params }: Ctx) {
  const session = await auth();
  if (!session?.user?.id) return json({ error: 'Sign in first.' }, 401);
  try {
    const { id } = await params;
    const { key } = await agentStore().newKey(id, { user: session.user.id, admin: !!session.user.admin });
    return json({ key });
  } catch (e) { return errorResponse(e); }
}
