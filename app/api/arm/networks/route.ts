import { auth } from '@/auth';
import { armNetStore } from '@/lib/arm/store.mjs';
import { publicName } from '@/lib/format';
import { errorResponse, json, notSignedIn, readBody } from '@/lib/arm/http';

export const dynamic = 'force-dynamic';

// The arm sim's saved networks (#362, lib/arm/store.mjs).
// GET ?arm=&task=: those of one arm and scenario (or all), without weights, the best exams first; anyone, signed in or not
// (names as the public pages show them; mine: saved by the one asking).
export async function GET(req: Request) {
  const session = await auth(), me = session?.user?.id ?? null, q = new URL(req.url).searchParams;
  try {
    const list = await armNetStore().list({ arm: q.get('arm') ?? undefined, task: q.get('task') ?? undefined });
    return json({ networks: list.map(({ owner, ...n }) => ({ ...n, ownerName: publicName(n.ownerName, !!me), mine: owner === me })) });
  } catch (e) { return errorResponse(e); }
}

// POST { name, net, exam? }: save one (net: the network as the page has it; exam: { done, of, time } as the page ran it).
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return notSignedIn();
  try {
    const b = await readBody(req);
    const { owner: _o, ...n } = await armNetStore().create({ name: b.name, net: b.net, exam: b.exam ?? null, owner: session.user.id, ownerName: session.user.name ?? null });
    return json({ network: { ...n, mine: true } }, 201);
  } catch (e) { return errorResponse(e); }
}
