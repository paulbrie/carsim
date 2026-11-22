import { auth } from '@/auth';
import { autopilotStore } from '@/lib/autopilots/store.mjs';
import { errorResponse, json, notSignedIn, readBody } from '@/lib/autopilots/http';

export const dynamic = 'force-dynamic';

// The sim's trained autopilots (ticket #311), saved by the drivers: lib/autopilots/store.mjs.
// GET: every one, without weights (mine: saved by the one asking), for anyone signed in.
export async function GET() {
  const session = await auth();
  if (!session?.user) return notSignedIn();
  const me = session.user.id;
  return json({ autopilots: autopilotStore().list().map(a => ({ ...a, mine: a.owner === me, owner: undefined })) });
}

// POST { name, training }: save one (training: what the sim's Save to file writes).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return notSignedIn();
  try {
    const b = await readBody(req);
    const a = autopilotStore().create({ name: b.name, training: b.training, owner: session.user.id, ownerName: session.user.name ?? null });
    return json({ autopilot: { ...a, mine: true, owner: undefined } }, 201);
  } catch (e) { return errorResponse(e); }
}
