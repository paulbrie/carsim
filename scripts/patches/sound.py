# The sound on or off (#343): M did nothing in the course editor (its key handler returned before it, while the engine
# idled on), nothing said whether the sound was on, and the choice was lost at every reload.
#   - one switch, `setMuted(on)`: tells the synth at once, says "Sound off" / "Sound on", keeps the choice in this
#     browser (carsim.muted);
#   - M handled before everything else in the key handler: the editor, a replay, a race, a training;
#   - `__sim.sound` ({ muted(), set(on) }) for the rail's Sound entry (public/sim/ui.js) and the race room's page,
#     which passes M on when the keyboard is in its own panel.
# Applies to public/sim/engine.js after the other patches (last in the chain):
#   python3 scripts/patches/sound.py <dir with engine.js>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep, encoding='utf-8').read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

rep("""let camMode = 0, audio = null, muted = false;
""", """let camMode = 0, audio = null, muted = false;
try { muted = localStorage.getItem('carsim.muted') === '1'; } catch (e) { }
// the sound on or off (M, the rail's Sound; #343): the synth told at once (a training's silence is its own: no audio
// then), said on screen, kept in this browser
function setMuted(on = !muted) {
  muted = !!on;
  try { if (muted) localStorage.setItem('carsim.muted', '1'); else localStorage.removeItem('carsim.muted'); } catch (e) { }
  audio?.node.port.postMessage({ on: muted || window.__sim?.paused ? 0 : 1 });
  flash(muted ? 'Sound off · M turns it on' : 'Sound on', '#fff', 1.4);
  return muted;
}
""")
rep("""  keys[e.code] = true;
  if (e.repeat) return;
""", """  keys[e.code] = true;
  if (e.repeat) return;
  if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey) { setMuted(); startAudio(); return; }   // (everywhere: the editor and a replay too)
""")
rep(""" if (e.code === 'KeyM') muted = !muted; return; }""", """ return; }""")
rep("""  if (e.code === 'KeyM') muted = !muted;
  startAudio();""", """  startAudio();""")
rep("""  Object.assign(window.__sim, { ai: AI, aiTrainSync, aiTry, aiDrive });
""", """  Object.assign(window.__sim, { ai: AI, aiTrainSync, aiTry, aiDrive });
  Object.assign(window.__sim, { sound: { muted: () => muted, set: setMuted } });   // (the rail's Sound, the room's page; #343)
""")
open(ep, 'w', encoding='utf-8').write(s)
