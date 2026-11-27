import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { AdminDashboard } from '@/components/admin-dashboard';
import { SiteNav } from '@/components/site-nav';
import { adminStore, type Dashboard } from '@/lib/dashboard/store.mjs';

export const metadata = { title: 'Dashboard', robots: { index: false } };
export const dynamic = 'force-dynamic';

// The super admin's dashboard (#357; lib/admin.ts): everyone who made an account (people and agents), every network, the runs.
export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect(`/signin?next=${encodeURIComponent('/admin')}`);
  if (!session.user.admin) redirect('/lobby');
  let data: Dashboard | null = null, error = '';
  try { data = await adminStore().dashboard(); } catch (e) { console.error('[admin]', e); error = (e as Error).message; }
  return (
    <div className="relative overflow-x-clip">
      <div aria-hidden className="grid-fade pointer-events-none absolute inset-0 h-[500px]" />
      <SiteNav user={{ name: session.user.name ?? 'Driver', image: session.user.image ?? null, admin: true }} />
      <main className="relative mx-auto max-w-7xl px-4 pt-10 pb-20 sm:px-6">
        <p className="eyebrow text-muted-foreground">Super admin</p>
        <h1 className="display mt-3 text-4xl sm:text-5xl">Dashboard</h1>
        {data ? <AdminDashboard data={data} /> : <p className="panel mt-8 p-6 text-destructive">The dashboard could not be read: {error}</p>}
      </main>
    </div>
  );
}
