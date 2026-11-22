import { adminSession } from '@/auth';
import { json } from '@/lib/bridge/http';

export const dynamic = 'force-dynamic';
// GET: may this user pair the sim with Claude (the super admin only)? The sim shows its 🤝 button if so.
export async function GET() { return json({ can: !!(await adminSession()) }); }
