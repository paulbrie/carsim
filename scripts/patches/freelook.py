# Look around the car (ticket #293): Shift+drag or right-drag swings the camera round the car in the
# chase view (and turns your head in the cockpit / driver's seat); let go and it eases back behind.
# The orbit (C) and editor cameras keep their own mouse controls.
# Applies to public/sim after the other patches (... road-level, damage):
#   python3 scripts/patches/freelook.py <dir with engine.js and index.html>
# (scripts/patches/mp-block.js carries the race's help line with it.)
import sys, os
d = sys.argv[1]
ep, hp = os.path.join(d, 'engine.js'), os.path.join(d, 'index.html')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

# ---------------------------------------------------------------- the drag
rep("""function setCamMode(m) {
  camMode = m;""", """/* Look around: Shift+drag or right-drag in the chase or cockpit view. look.yaw / look.pitch offset the
   view (drag right: the view turns right, as with the orbit camera; drag down: from higher up / looking
   down); released, it waits a moment and eases back. */
const look = { yaw: 0, pitch: 0, drag: null, idle: 0 };
const lookable = () => !ed.on && (camMode === 0 || camMode === 1);
const wrapPi = a => a - Math.round(a / TAU) * TAU;
renderer.domElement.addEventListener('pointerdown', ev => {
  if (!lookable() || !(ev.button === 2 || (ev.button === 0 && ev.shiftKey))) return;
  look.drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
  try { renderer.domElement.setPointerCapture(ev.pointerId); } catch (e) { }
  ev.preventDefault();
});
renderer.domElement.addEventListener('pointermove', ev => {
  const g = look.drag; if (!g || ev.pointerId !== g.id) return;
  look.yaw = wrapPi(look.yaw - (ev.clientX - g.x) * 0.006);
  look.pitch = clamp(look.pitch + (ev.clientY - g.y) * 0.004, -0.35, 1.0);
  g.x = ev.clientX; g.y = ev.clientY; look.idle = 0;
});
const lookEnd = ev => { if (look.drag && ev.pointerId === look.drag.id) look.drag = null; };
renderer.domElement.addEventListener('pointerup', lookEnd);
renderer.domElement.addEventListener('pointercancel', lookEnd);
renderer.domElement.addEventListener('contextmenu', ev => { if (!ed.on) ev.preventDefault(); });   // right-drag looks; no menu
function easeLook(dt) {
  if (look.drag || (!look.yaw && !look.pitch)) return;
  if ((look.idle += dt) < 0.7) return;                       // a moment to take it in, then back behind the car
  const k = Math.exp(-4 * dt); look.yaw *= k; look.pitch *= k;
  if (Math.abs(look.yaw) < 0.002 && Math.abs(look.pitch) < 0.002) look.yaw = look.pitch = 0;
}
// where the chase camera sits: behind the car, swung round it by look.yaw and up or down by look.pitch
function chaseSpot(out) {
  const back = VEH.cam.back, up = VEH.cam.up;
  if (!look.yaw && !look.pitch) { out.copy(car.pos).addScaledVector(camFwd, -back); out.y += up; return out; }
  const r = Math.hypot(back, up), e = clamp(Math.atan2(up, back) + look.pitch, -0.05, 1.45), c = Math.cos(look.yaw), sn = Math.sin(look.yaw);
  const ox = -camFwd.x, oz = -camFwd.z, h = r * Math.cos(e);
  return out.set(car.pos.x + (ox * c + oz * sn) * h, car.pos.y + r * Math.sin(e), car.pos.z + (oz * c - ox * sn) * h);
}
function setCamMode(m) {
  look.yaw = look.pitch = 0; look.drag = null;
  camMode = m;""")

# ---------------------------------------------------------------- the cameras
rep("""  if (camMode === 1) {
    camera.position.copy(v1.set(...(VEH.cam.driver || VEH.cam.cockpit)).applyQuaternion(car.q).add(car.pos));
    camera.quaternion.copy(car.q).multiply(qw.setFromAxisAngle(v2.set(0, 1, 0), Math.PI));
    camera.rotateX(inside ? DRIVER_CAM.pitch : -0.08);""", """  easeLook(dt);
  if (camMode === 1) {
    camera.position.copy(v1.set(...(VEH.cam.driver || VEH.cam.cockpit)).applyQuaternion(car.q).add(car.pos));
    camera.quaternion.copy(car.q).multiply(qw.setFromAxisAngle(v2.set(0, 1, 0), Math.PI));
    if (look.yaw) camera.rotateY(clamp(look.yaw, -2.3, 2.3));     // turning your head, not all the way round
    camera.rotateX((inside ? DRIVER_CAM.pitch : -0.08) - look.pitch * 0.7);""")
rep("""  const target = v2.copy(car.pos).addScaledVector(camFwd, -VEH.cam.back); target.y += VEH.cam.up;
  target.y = Math.max(target.y, heightAt(target.x, target.z) + 1.2);
  camPos.lerp(target, 1 - Math.exp(-6 * dt));
  camera.position.copy(camPos);
  camLook.lerp(v3.copy(car.pos).addScaledVector(camFwd, 2).add(v4.set(0, 0.8, 0)), 1 - Math.exp(-10 * dt));""",
"""  const target = chaseSpot(v2);
  target.y = Math.max(target.y, heightAt(target.x, target.z) + 1.2);
  camPos.lerp(target, 1 - Math.exp(-(look.drag ? 20 : 6) * dt));   // dragging: the camera keeps up with the hand
  camera.position.copy(camPos);
  camLook.lerp(v3.copy(car.pos).addScaledVector(camFwd, 2 * Math.max(0, Math.cos(look.yaw))).add(v4.set(0, 0.8, 0)), 1 - Math.exp(-10 * dt));""")

# ---------------------------------------------------------------- the help line (single player; the race's is in mp-block.js)
open(ep, 'w').write(s)
h = open(hp).read()
a = '<b>C</b> camera (chase / bonnet / side / under / orbit) &nbsp; '
assert h.count(a) == 1
open(hp, 'w').write(h.replace(a, a + '<b>Shift/right-drag</b> look around the car &nbsp; '))
print('freelook patched')
