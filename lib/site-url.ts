import { BASE_PATH } from '@/lib/base-path';

const SITE = (process.env.SITE_URL || 'https://carsim.paulbrie.com').replace(/\/+$/, '');

/**
 * The app's address as the visitor's browser has it (the proxy's host and protocol, and the base path), for the URLs
 * the developers' page and the downloads print (#355). The host comes from a header: only a plain host name (and port)
 * is taken, anything else gives the site's own address (SITE_URL).
 */
export function siteUrl(h: Headers): string {
  const first = (v: string | null) => v?.split(',')[0]?.trim() || '';
  const host = first(h.get('x-forwarded-host')) || first(h.get('host')), proto = first(h.get('x-forwarded-proto'));
  if (!/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/i.test(host)) return SITE + BASE_PATH;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  return `${proto === 'http' || proto === 'https' ? proto : local ? 'http' : 'https'}://${host}${BASE_PATH}`;
}
