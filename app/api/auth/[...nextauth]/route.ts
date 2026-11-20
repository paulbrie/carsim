import { NextRequest } from 'next/server';
import { handlers } from '@/auth';
import { BASE_PATH } from '@/lib/base-path';

// Auth.js builds its URLs (the OAuth callback among them) from the request's URL, which here is
// what the custom server bound to (http://0.0.0.0:<port>) and lacks Next's basePath, while
// auth.ts gives Auth.js the full one. Rebuild the URL the browser used: the public host and
// protocol from the proxy's headers, and the prefix put back.
const publicUrl = (handler: (req: NextRequest) => Promise<Response>) => (req: NextRequest) => {
  const h = req.headers, first = (v: string | null) => v?.split(',')[0]?.trim();
  const host = first(h.get('x-forwarded-host')) || first(h.get('host'));
  const proto = first(h.get('x-forwarded-proto'));
  const own = new URL(req.url);
  // (a new URL, not url.host = …: that keeps the bound port when the public host has none)
  const url = host ? new URL(own.pathname + own.search, `${proto === 'http' || proto === 'https' ? proto : own.protocol.slice(0, -1)}://${host}`) : own;
  if (BASE_PATH && !url.pathname.startsWith(`${BASE_PATH}/`)) url.pathname = BASE_PATH + url.pathname;
  return handler(new NextRequest(url, req));
};

export const GET = publicUrl(handlers.GET);
export const POST = publicUrl(handlers.POST);
