import { BASE_PATH } from '@/lib/base-path';

// The site's public address (SITE_URL), and an address on it with the path the app is mounted at
export const SITE = process.env.SITE_URL || 'https://carsim.paulbrie.com';
export const siteUrl = (path: string) => `${SITE.replace(/\/+$/, '')}${BASE_PATH}${path}`;
