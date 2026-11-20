# Agents working on carsim

See README.md for the layout. Notes:

- `public/sim/engine.js` is the original engine plus the multiplayer block. When you change the
  multiplayer hooks, change `scripts/patches/mp-block.js` / `mp-hooks.py` too, and for the editor's
  SHAPE tools (smoothing, banking) `scripts/patches/track-shape.py`, so a new drop of the sim can be
  re-patched; the gates (height, fade near the camera) are `scripts/patches/gates.py`, the driver's-seat
  camera `cameras.py`, the maps (a room's course, the `?edit=1` map editor) `maps.py` (check: extract
  the original `index.html` to a scratch dir, run mp-hooks, track-shape, gates, cameras, maps, diff
  engine.js: it must be identical).
- `window.__sim` already has getters (TRACK, VEH, BRIDGE): adding another of the same name to it
  with Object.assign throws at boot and the sim never starts.
- Headless Chrome here draws the sim at about a frame a second (software WebGL). To test races,
  step the physics instead: in the iframe, `__sim.step(n)`, `__sim.placeAtGate(i, back)`,
  `__sim.override = { throttle, brake, steer }`; and use `scripts/bot-driver.mjs` for a second driver.
- UI SDK: read `node_modules/@ui-sdk/react/docs/llms.txt` (and the component pages) before using a
  component; its parts are unstyled, styles live in `app/globals.css` (`.seg*`, `.cp-*`).
- shadcn components import `cn` from `@/lib/utils` (the CLI wrote `from "cn"`, an unrelated npm
  package: rewrite it if you add components).
- Dev server: `npm run dev` on port 7001 (3000 is the admin).
- Maps: only the super admin (`lib/admin.ts`) may write them; every write path (`app/api/maps`) checks
  `session.user.admin` on the server. To test as the admin locally, sign a session cookie with
  `AUTH_SECRET` (`@auth/core/jwt` `encode`, salt `authjs.session-token`, claims `provider: 'google'`,
  `email`, `emailVerified: true`).
