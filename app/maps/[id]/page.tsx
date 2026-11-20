import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { MapEditor } from '@/components/map-editor';
import { mapStore } from '@/lib/maps/store.mjs';

export const metadata = { title: 'Map editor · Sand Buggy Rally' };
export const dynamic = 'force-dynamic';

// The sim's course editor on one map, saved to the server. Super admin only.
export default async function MapEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/?next=${encodeURIComponent(`/maps/${id}`)}`);
  if (!session.user.admin) redirect('/lobby');
  const map = mapStore().get(id);
  if (!map) notFound();
  // the course (up to a few MB) is fetched by the page, not sent along with it
  return <MapEditor id={map.id} name={map.name} builtin={map.builtin} />;
}
