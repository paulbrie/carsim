import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/site';

// everything public is open; the API, the sign-in, the race rooms and the editor are not for crawlers
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/signin', '/lobby', '/race/', '/maps'] },
    sitemap: siteUrl('/sitemap.xml'),
  };
}
