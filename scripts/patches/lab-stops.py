# The TNN lab's training stops (ticket #323: "in production train generations stop randomly"):
#   - why it stopped, kept: the training stops by itself (no better lap in N generations, N generations done, an error,
#     another course or car, the world rebuilt, a race), and that was only a 3 s flash, drawn under the full-screen lab
#     (z-index 20) where /lab opens since #320: the training seemed to stop for nothing. Now the lab's status line says
#     so until the next training (AI.stopWhy), the Generation box says "stopped", and the flash shows over the lab;
#   - a hidden tab (another tab in front, the window minimised) gets no animation frames, and the training was driven
#     by them: it waited. Now it goes on from a message loop while the tab is hidden (aiBgKick).
# Applies to public/sim/engine.js after the other patches (... autopilot, pause, circuits, bridge):
#   python3 scripts/patches/lab-stops.py <dir with engine.js>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep).read()

def rep(a, b, n=1):
    global s
    c = s.count(a)
    assert c == n, (c, n, a[:140])
    s = s.replace(a, b)

# ---------------------------------------------------------------- why it stopped, kept
rep("""  if (aiKey() !== AI.key) { aiTrain(false); return; }                 // another course or car""",
    """  if (aiKey() !== AI.key) { aiStopped('another course or car'); return; }   // another course or car""")
rep("""    AI.autoStopWhy = AI.autoStop; AI.autoStop = false; aiTrain(false);
    flash(`Training stopped: ${AI.autoStopWhy}`, '#9fd4ff', 3);""",
    """    AI.autoStopWhy = AI.autoStop; AI.autoStop = false; aiStopped(AI.autoStopWhy, true);""")
rep("""  try { aiTrain(false); } catch (e2) { AI.training = false; }
  flash(`Training stopped: an error""",
    """  AI.stopWhy = { why: `an error: ${String(e && e.message || e).slice(0, 160)}`, gen: AI.gen, err: true };   // (before: aiTrain shows it)
  try { aiTrain(false); } catch (e2) { AI.training = false; }
  flash(`Training stopped: an error""")
rep("""function aiTrain(on) {
  if (on === AI.training) return;
  AI.autoStop = false;""", """// the training stopped by itself (#323): why, flashed and kept for the lab's status line until the next training
function aiStopped(why, auto) {
  aiTrain(false);
  AI.stopWhy = { why, gen: AI.gen, auto: !!auto };
  flash(`Training stopped: ${why}`, '#9fd4ff', 4); aiShow();
}
const aiEsc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function aiStopLine() {
  const S = AI.stopWhy;
  return `<b style="color:${S.err ? '#ff8a7a' : '#ffd88a'}">Training stopped at generation ${S.gen}: ${aiEsc(S.why)}</b>`
    + (S.auto && /no better lap/.test(S.why) ? ' · <span style="opacity:.8">the setting “stop after generations without a better lap” (0: never)</span>' : '')
    + ` · ${AI.gen ? 'Train more goes on from here' : 'Train to start again'}`;
}
function aiTrain(on) {
  if (on === AI.training) return;
  AI.autoStop = false;
  if (on) AI.stopWhy = null;""")
# the world rebuilt, the editor opened, a race: the training stops, and says why
rep("""function aiHalt(drive) { try { if (AI.training) aiTrain(false);""",
    """function aiHalt(drive, why) { try { if (AI.training) { aiTrain(false); if (why) { AI.stopWhy = { why, gen: AI.gen }; aiShow(); } }""")
rep("""  aiHalt();\n""", """  aiHalt(false, 'the world was rebuilt (another course, ground or map)');\n""")
rep("""  if (on) aiHalt();""", """  if (on) aiHalt(false, 'the course editor opened');""")
rep("""  aiHalt(true);""", """  aiHalt(true, 'a race started');""")
# the panel: the Generation box, and the status line
rep(""": AI.gen ? 'paused' : 'not trained',""", """: AI.stopWhy ? 'stopped' : AI.gen ? 'paused' : 'not trained',""")
rep(""" : AI.drive ? `<b>${AI.race ? 'Racing' : 'Driving'} its best</b>` : best === 'nothing yet'""",
    """ : AI.drive ? `<b>${AI.race ? 'Racing' : 'Driving'} its best</b>` : AI.stopWhy ? aiStopLine() : best === 'nothing yet'""")
# the flash over the full-screen lab
rep("""  #aiPanel{display:none;left:12px;top:250px;width:270px;overflow:auto;pointer-events:auto;z-index:3}""",
    """  #aiPanel{display:none;left:12px;top:250px;width:270px;overflow:auto;pointer-events:auto;z-index:3}
  #toast{z-index:30}""")

# ---------------------------------------------------------------- a hidden tab goes on training
rep("""    if (AI.par) aiPoolStart();
  } else {""", """    if (AI.par) aiPoolStart();
    aiBgKick();
  } else {""")
rep("""function aiHalt(drive, why) {""", """// A hidden tab (another tab in front, the window minimised) gets no animation frames, and the training waited for
// them (#323): while hidden it goes on from here, a frame's worth at a time, from a message to itself (not slowed down
// as a hidden tab's timers are); the workers' results come in between. Shown again, the frames take over.
const aiBg = { ch: null, on: false, t: 0 };
function aiBgKick() {
  if (AI_WK || aiBg.on || !AI.training || !document.hidden) return;
  if (!aiBg.ch) { aiBg.ch = new MessageChannel(); aiBg.ch.port1.onmessage = aiBgSlice; }
  aiBg.on = true; aiBg.ch.port2.postMessage(0);
}
function aiBgSlice() {
  aiBg.on = false;
  if (!AI.training || !document.hidden) return;
  const now = performance.now(), dt = Math.min((now - (aiBg.t || now)) / 1000, 0.05); aiBg.t = now;
  try { aiTrainFrame(dt); } catch (e) { aiTrainFail(e); }
  aiBgKick();
}
if (!AI_WK) document.addEventListener('visibilitychange', () => { aiBg.t = 0; aiBgKick(); });
function aiHalt(drive, why) {""")

open(ep, 'w').write(s)
print('lab-stops patched')
