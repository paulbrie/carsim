import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Lobby } from '@/components/lobby';

export const metadata = { title: 'Race' };

export default async function LobbyPage() {
  const session = await auth();
  if (!session?.user) redirect('/signin?next=/lobby');
  return <Lobby user={{ name: session.user.name ?? 'Driver', image: session.user.image ?? null, admin: session.user.admin }} />;
}
