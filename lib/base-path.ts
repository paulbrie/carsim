// The path the app is mounted at: '' at a domain's root (Railway), '/projects/carsim' behind the
// Genie box's nginx (BASE_PATH in .env.local, passed to the client by next.config.ts).
// Next's router, <Link> and redirect() add it themselves; fetch(), WebSocket URLs, the sim's
// iframe, copied links and Auth.js redirects need it added by hand.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';
export const withBase = (path: string) => `${BASE_PATH}${path}`;
