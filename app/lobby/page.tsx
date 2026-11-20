import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { Lobby } from '@/components/lobby';

export const metadata = { title: 'Lobby · Sand Buggy Rally' };

export default async function LobbyPage() {
  const session = await auth();
  if (!session?.user) redirect('/');
  return <Lobby user={{ name: session.user.name ?? 'Driver', image: session.user.image ?? null, admin: session.user.admin }} />;
}
