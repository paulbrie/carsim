# Claude bridge (a Claude session working in the super admin's sim page): the page loads public/sim/bridge.js, which
# does it all, and the renderer is on window.__sim for its screenshots. Server: lib/bridge/store.mjs, app/api/bridge.
# Applies to public/sim after the other patches (last in the chain):
#   python3 scripts/patches/bridge.py <dir with engine.js and index.html>
import sys, os
d = sys.argv[1]
ep, hp = os.path.join(d, 'engine.js'), os.path.join(d, 'index.html')
s = open(ep).read()
a = """  Object.assign(window.__sim, { ai: AI, aiTrainSync, aiTry, aiDrive });"""
assert s.count(a) == 1
s = s.replace(a, a + """
  Object.assign(window.__sim, { renderer });                                      // for the Claude bridge's screenshots (bridge.js)""")
open(ep, 'w').write(s)
h = open(hp).read()
a = """<script type="module" src="engine.js"></script>"""
assert h.count(a) == 1
h = h.replace(a, a + """
<script type="module" src="bridge.js"></script>""")
open(hp, 'w').write(h)
print('bridge patched')
