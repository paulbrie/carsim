# Maps (ticket #287): a race runs on the room's map, and ?edit=1 is the super admin's map editor.
# The functions are in the MP block (scripts/patches/mp-block.js: mpParentCourse, mpCourseFrom,
# mpSetCourse, mpEditMessage, mpEditFrame); these are the hooks into the engine.
# Applies to public/sim/engine.js after the other patches:
#   python3 scripts/patches/maps.py <dir with engine.js>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

# --- the editor flag, next to the race's
rep("""const MP = { on: MPQ.get('mp') === '1', hold: false,""",
    """const MP = { on: MPQ.get('mp') === '1', edit: MPQ.get('edit') === '1', courseKey: null, sig: null, hold: false,""")

# --- the course: the map the page holds (a race on the room's ground; the editor as saved)
rep("""if (MP.on) {
  const g = MPQ.get('ground');
  COURSE = { wp: DEFAULT_WP.map(p => p.slice()), ops: [], base: g === 'earth' ? 'earth' : 'sand', road: g === 'road', bridges: [], noBridge: [] };
}""", """if (MP.on || MP.edit) {
  const pc = mpParentCourse();
  MP.courseKey = pc?.key ?? null;
  COURSE = mpCourseFrom(pc?.course, MP.on ? MPQ.get('ground') || 'sand' : null);
}""")

# --- nothing of the map goes to this browser's own single-player course
rep("""function saveCourse() {
  if (MP.on) return true;""", """function saveCourse() {
  if (MP.on || MP.edit) return true;""")
rep("""  if (!MP.on) try { localStorage.setItem('sandbuggy.surface', road ? 'road' : COURSE.base); } catch (e) { }""",
    """  if (!MP.on && !MP.edit) try { localStorage.setItem('sandbuggy.surface', road ? 'road' : COURSE.base); } catch (e) { }""")

# --- the editor opens on the course editor, without the start menu
rep("""  mpPost({ t: 'ready' });
}, 30);""", """  mpPost({ t: 'ready' });
  if (MP.edit) { document.getElementById('menu').style.display = 'none'; toggleEditor(true); MP.sig = mpEditSig(); mpPost({ t: 'sig', sig: MP.sig }); }   // the map as loaded: nothing to save yet
}, 30);""")

open(ep, 'w').write(s)
print('maps patched')
