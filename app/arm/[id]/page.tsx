import { cache } from 'react';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { ArmPage } from '@/components/arm-page';
import { ARMS, TASKS } from '@/lib/arm/core.mjs';
import { armNetStore } from '@/lib/arm/store.mjs';
import { publicName } from '@/lib/format';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

// A saved arm network's link (#364): /arm with it on show, its arm and scenario chosen, watching. Anyone may open it, as
// anyone may load it from the list (#362); the maker's name as the public pages show it to a visitor (publicName).
const network = cache((id: string) => armNetStore().get(id).catch(e => { console.error('[arm link]', e); return null; }));
const examText = (e: { done: number; of: number; time: number } | null) => e ? `${e.done} of ${e.of}${e.done > 0 ? ` in ${e.time.toFixed(1)} s` : ''}` : null;

export async function generateMetadata({ params }: Ctx) {
  const a = await network((await params).id);
  if (!a) return { title: 'The arm (preview)' };
  const title = `${a.name} · an arm network`, ex = examText(a.exam);
  const description = `A network of ${a.weights} weights by ${publicName(a.ownerName, false)} for ${ARMS[a.arm].name} · ${TASKS[a.task].name}${ex ? `: ${ex} in its exam` : ''}. Watch it in the arm sim, try the same placements by hand, train your own.`;
  return { title, description, openGraph: { title, description } };
}

export default async function ArmLink({ params }: Ctx) {
  const a = await network((await params).id);
  if (!a) notFound();
  const session = await auth();
  return <ArmPage shared={{ id: a.id, name: a.name, by: publicName(a.ownerName, !!session?.user), net: { ...a.net, exam: a.exam } }} />;
}
