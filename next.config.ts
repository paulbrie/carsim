import type { NextConfig } from 'next';

// Mounted under a path (e.g. /projects/carsim behind the box's nginx, which keeps the prefix), or at the root
const basePath = (process.env.BASE_PATH || '').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // `next dev` reached through a public host (e.g. the box's https://<host>/projects/carsim): Next blocks
  // its dev resources (HMR, so hydration) for hosts it doesn't know
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  // the old addresses of driving alone and the lab (gone: the sim is only in race rooms and the map editor)
  async redirects() {
    return [
      { source: '/drive', destination: '/lobby', permanent: false },
      { source: '/lab', destination: '/lobby', permanent: false },
    ];
  },
  async headers() {
    return [
      // the sim's models and three.js: big, and they only change with a deploy
      { source: '/sim/models/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }] },
      { source: '/sim/vendor/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] },
      // MuJoCo for the arm sim (11 MB, fetched by the page and by each of its workers)
      { source: '/arm/vendor/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] },
      { source: '/fonts/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
    ];
  },
};

export default nextConfig;
