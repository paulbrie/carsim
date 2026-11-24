# Pausing the drive (P, or the Pause button left of Replay, or of the Autopilot button beside it in a room): the physics stands still (the lap's clock with it, and
# the engine's sound), while the camera, looking around and the panels go on. Not in a race (its countdown and the
# race: the room's clock doesn't stop), in the editor or a replay, nor while the autopilot trains (Stop is its pause);
# a race or a training that starts ends a pause. Tire pressure, P before, is Shift+P.
# Applies to public/sim/engine.js and index.html after autopilot.py:
#   python3 scripts/patches/pause.py <dir with engine.js and index.html>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js'); hp = os.path.join(sys.argv[1], 'index.html')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

# the keys: P pauses, Shift+P the tire pressure
rep("""  if (e.code === 'KeyP') car.pIdx = (car.pIdx + 1) % PRESSURES.length;""",
    """  if (e.code === 'KeyP' && e.shiftKey) car.pIdx = (car.pIdx + 1) % PRESSURES.length;
  else if (e.code === 'KeyP') { simPause(); return; }""")
# the engine quiet while paused
rep("""on: muted ? 0 : 1,""", """on: muted || window.__sim?.paused ? 0 : 1,""")
# the race's help line (the single player's is index.html's)
rep("""<b>P</b> tire pressure &nbsp; """, """<b>P</b> pause &nbsp; <b>Shift+P</b> tire pressure &nbsp; """)

rep("""function frame(now) {""", """// ---------- pausing the drive (P, the Pause button) ----------
document.head.insertAdjacentHTML('beforeend', `<style>
  #pauseBtn{position:fixed;top:252px;right:120px;font:inherit;font-size:13px;font-weight:700;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;color:#fff;background:rgba(20,14,6,.65);min-width:92px}
  #pauseBtn.on{background:rgba(255,210,125,.9);color:#1a1208}
  #pauseNote{display:none;top:36%;left:50%;transform:translateX(-50%);text-align:center;padding:12px 22px}
  #pauseNote b{display:block;font-size:30px;letter-spacing:6px} #pauseNote small{opacity:.8}
</style>`);
const pauseBtn = document.createElement('button'); pauseBtn.id = 'pauseBtn'; pauseBtn.style.display = 'none';
pauseBtn.addEventListener('click', e => { e.currentTarget.blur(); simPause(); });
const pauseNote = document.createElement('div'); pauseNote.id = 'pauseNote'; pauseNote.className = 'panel';
pauseNote.innerHTML = '<b>PAUSED</b><small>P or ▶ Resume to drive on</small>';
document.body.append(pauseBtn, pauseNote);
// why the drive can't be paused now ('' : it can)
const simPauseWhyNot = () => MP.on && (MP.phase === 'countdown' || MP.phase === 'racing') && !MP.finished ? 'No pause in a race'
  : AI.training ? 'The autopilot is training: Stop stops it' : ed.on || rp.on ? 'Nothing to pause here' : '';
function simPause(on = !window.__sim.paused) {
  const why = on && simPauseWhyNot();
  if (why) { flash(why, '#ffd88a', 1.5); return; }
  window.__sim.paused = on; pauseShowT = 0;
}
// each frame: a race or a training starting ends the pause; every 0.1 s the button (left of Replay, as it is shown) and the note
let pauseShowT = 0;
function pauseFrame(dt) {
  if (window.__sim.paused && (AI.training || (MP.on && (MP.phase === 'countdown' || MP.phase === 'racing') && !MP.finished))) window.__sim.paused = false;
  if ((pauseShowT -= dt) > 0) return; pauseShowT = 0.1;
  // (in a room the Autopilot button is left of Replay: then left of it)
  const p = !!window.__sim.paused, rb = document.getElementById('replayBtn'), r = (MP.on && rb.offsetWidth && AI.btn.offsetWidth ? AI.btn : rb).getBoundingClientRect();
  pauseNote.style.display = p && !ed.on && !rp.on ? 'block' : 'none';
  pauseBtn.style.display = r.width ? '' : 'none';
  if (!r.width) return;
  pauseBtn.style.top = r.top + 'px'; pauseBtn.style.right = (innerWidth - r.left + 8) + 'px';
  const label = p ? '▶ Resume' : '⏸ Pause';
  if (pauseBtn.textContent !== label) { pauseBtn.textContent = label; pauseBtn.classList.toggle('on', p); pauseBtn.title = p ? 'Drive on (P)' : 'Pause the drive (P)'; }
}
function frame(now) {""")
rep("""  updateAudio();""", """  updateAudio(); pauseFrame(dt);""")
open(ep, 'w').write(s)

# the single player's help line
h = open(hp).read()
a = '<b>P</b> tire pressure &nbsp; '
assert h.count(a) == 1
open(hp, 'w').write(h.replace(a, '<b>P</b> pause &nbsp; <b>Shift+P</b> tire pressure &nbsp; '))
print('pause patched')
