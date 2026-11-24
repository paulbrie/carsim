import { adminSession } from '@/auth';
import { json } from '@/lib/bridge/http';
import { bridgeOn } from '@/lib/bridge/store.mjs';

export const dynamic = 'force-dynamic';
// GET: may this user pair the sim with Claude (the super admin only, and not in production: bridgeOn)? The sim shows its
// 🤝 button if so.
export async function GET() { return json({ can: bridgeOn() && !!(await adminSession()) }); }
