# Gates (start/finish and checkpoints): taller, and 75% transparent when the camera comes close,
# so they never block the view (ticket #283).
# Applies to public/sim/engine.js after mp-hooks.py and track-shape.py:
#   python3 scripts/patches/gates.py <dir with engine.js>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

# taller: posts 3.8 → 6 m, the banner just under their tops (its foot from ~2.9 m to ~5.1 m)
rep("""const RAMP = 40, DECK_H = 4.4, POST_H = 3.8;""",
    """const RAMP = 40, DECK_H = 4.4, POST_H = 6, BANNER_Y = POST_H - 0.4;   // gate posts and the banner's centre, above the ground""")
rep("""    banner.position.set(g.p.x, (g.posts[0].y + g.posts[1].y) / 2 + 3.4, g.p.z);""",
    """    banner.position.set(g.p.x, (g.posts[0].y + g.posts[1].y) / 2 + BANNER_Y, g.p.z);""")
rep("""      for (const P of g.posts) { v1.set(0, 3.6, 0).applyQuaternion(P.pivot.quaternion).add(P.pivot.position);""",
    """      for (const P of g.posts) { v1.set(0, POST_H - 0.2, 0).applyQuaternion(P.pivot.quaternion).add(P.pivot.position);""")

# each gate its own post material, so it can fade on its own
rep("""      const post = new THREE.Mesh(postGeo, postMat); post.position.y = POST_H / 2; pivot.add(post);""",
    """      const post = new THREE.Mesh(postGeo, g.postMat ||= postMat.clone()); post.position.y = POST_H / 2; pivot.add(post);""")
rep("""    g.mat = mat; g.banner = banner;""",
    """    g.mat = mat; g.fadeMats = [mat, g.postMat]; g.fade = 1; g.banner = banner;""")

# the fade, every frame after the camera has moved
rep("""function repairGates() {""", """// A gate the camera comes near fades to 25% (75% transparent): fully from 6 m to its frame (the
// box between its posts, ground to banner), back to solid by 15 m.
const GATE_FADE = { near: 6, far: 15, min: 0.25 };
function fadeGates() {
  const c = camera.position;
  for (const g of TRACK.gates) {
    if (!g.fadeMats) continue;
    const a = (c.x - g.p.x) * g.t.x + (c.z - g.p.z) * g.t.z, l = Math.abs((c.x - g.p.x) * g.n.x + (c.z - g.p.z) * g.n.z) - g.half;
    const y0 = Math.min(g.posts[0].y, g.posts[1].y) - 0.2, y1 = Math.max(g.posts[0].y, g.posts[1].y) + POST_H;
    const d = Math.hypot(a, Math.max(0, l), c.y < y0 ? y0 - c.y : Math.max(0, c.y - y1));
    const o = lerp(GATE_FADE.min, 1, smooth(clamp((d - GATE_FADE.near) / (GATE_FADE.far - GATE_FADE.near), 0, 1)));
    if (Math.abs(o - g.fade) < 0.004 && (o === 1) === (g.fade === 1)) continue;
    g.fade = o;
    for (const m of g.fadeMats) {
      const see = o < 0.999;
      if (m.transparent !== see) { m.transparent = see; m.depthWrite = !see; m.needsUpdate = true; }
      m.opacity = see ? o : 1;
    }
  }
}
function repairGates() {""")
rep("""  updateCamera(dt);
""", """  updateCamera(dt);
  fadeGates();
""")

open(ep, 'w').write(s)
print('gates patched')
