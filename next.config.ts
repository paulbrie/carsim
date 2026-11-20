import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async headers() {
    return [
      // the sim's models and three.js: big, and they only change with a deploy
      { source: '/sim/models/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }] },
      { source: '/sim/vendor/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }] },
    ];
  },
};

export default nextConfig;
