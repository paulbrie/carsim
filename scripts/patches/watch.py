# Watching a duel (the leaderboard's Watch the duel, app/duel/...): the sim in a frame as
# /sim/index.html?mp=1&watch=1&ground=…&vehicle=…, with the page as its room. The page sends the course (window.__simCourse),
# the ground, the car, the human's best lap as the ghost (`ghost`) and the saved network (`watch {network}`), which drives
# (aiPreviewLoad, #336: nothing of it is kept in this browser) while the ghost sets off with each of its laps. Nobody
# drives: the sim answers only the camera (C) and the sound (M), and the rail is hidden (no lab, no setup).
# Applies to public/sim/engine.js, last in the chain (after sound.py):
#   python3 scripts/patches/watch.py <dir with engine.js>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep, encoding='utf-8').read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

rep("""    case 'ghost': mpGhostMsg(m); break;
""", """    case 'ghost': mpGhostMsg(m); break;
    case 'watch': mpWatch(m.network); break;
""")

rep("""    flash(race ? 'Autopilot against the rival (any driving key takes over)' : 'Autopilot: hands off (any driving key takes over)', '#9fd4ff', 2.5);""",
    """    if (!MP.watch) flash(race ? 'Autopilot against the rival (any driving key takes over)' : 'Autopilot: hands off (any driving key takes over)', '#9fd4ff', 2.5);""")

rep("""// back to this browser's own training, with its own settings
function aiPreviewEnd() {""", """// ---------- watching a duel: ?mp=1&watch=1 in the page /duel/<track>/<ground>/<car> ----------
// The page is the room: course, ground, car, the human's lap as the ghost, then the network to drive ('watch'). Only the
// camera (C) and the sound (M) answer; the rest of the keys never reach the sim (no driving, no lab: nothing to take over).
MP.watch = MP.on && MPQ.get('watch') === '1';
if (MP.watch) {
  document.body.classList.add('watch');
  document.head.insertAdjacentHTML('beforeend', '<style>body.watch #uiRail,body.watch #aiPanel{display:none!important}</style>');
  const pass = e => e.ctrlKey || e.metaKey || e.altKey || e.code === 'KeyC' || e.code === 'KeyM';
  addEventListener('keydown', e => { if (!pass(e)) e.stopImmediatePropagation(); }, true);
  addEventListener('keyup', e => { if (!pass(e)) e.stopImmediatePropagation(); }, true);
}
function mpWatch(n) {
  if (!MP.watch) return;
  if (!aiPreviewLoad(n)) { flash('That network does not fit this sim', '#ffd88a', 6); mpPost({ t: 'watch', ok: false }); return; }
  aiDrive(true); mpPost({ t: 'watch', ok: true });
}
// it keeps driving (stuck: the preview's own restart from the grid, above)
setInterval(() => { if (MP.watch && AI.preview && !AI.drive && !AI.training && !window.__sim?.paused) aiDrive(true); }, 1000);
// back to this browser's own training, with its own settings
function aiPreviewEnd() {""")

open(ep, 'w', encoding='utf-8').write(s)
print('watch: ok')
