import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { MapsAdmin } from '@/components/maps-admin';
import { mapStore } from '@/lib/maps/store.mjs';

export const metadata = { title: 'Maps · Sand Buggy Rally' };
export const dynamic = 'force-dynamic';

// The super admin's maps (lib/admin.ts): create, copy, delete, and open one in the editor.
export default async function MapsPage() {
  const session = await auth();
  if (!session?.user) redirect(`/?next=${encodeURIComponent('/maps')}`);
  if (!session.user.admin) redirect('/lobby');
  return <MapsAdmin initial={await mapStore().list()} user={{ name: session.user.name ?? 'Driver', image: session.user.image ?? null, admin: true }} />;
}
