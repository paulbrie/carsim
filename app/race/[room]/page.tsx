import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { RaceRoom } from '@/components/race-room';

export const metadata = { title: 'Race · Sand Buggy Rally' };

export default async function RacePage({ params }: { params: Promise<{ room: string }> }) {
  const { room } = await params;
  const id = room.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const session = await auth();
  if (!session?.user) redirect(`/?next=${encodeURIComponent(`/race/${id}`)}`);
  return <RaceRoom roomId={id} user={{ name: session.user.name ?? 'Driver', image: session.user.image ?? null }} />;
}
