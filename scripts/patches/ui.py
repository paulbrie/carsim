# Carsim's interface for the sim's own page (ticket #320): public/sim/ui.css (the look) and public/sim/ui.js (the rail
# of buttons, the keys sheet, the start menu's frame, the way home, ?lab=1), over what the sim builds itself.
# Nothing in engine.js: the page loads the two files, after the sim's own styles and scripts, and takes the name.
# Applies to public/sim after the other patches (last in the chain, after bridge.py):
#   python3 scripts/patches/ui.py <dir with engine.js and index.html>
import sys, os
hp = os.path.join(sys.argv[1], 'index.html')
h = open(hp, encoding='utf-8').read()
def rep(a, b):
    global h
    assert h.count(a) == 1, a
    h = h.replace(a, b)
rep("<title>Sand Buggy</title>", "<title>Carsim</title>")
rep("""</style>
<script type="importmap">""", """</style>
<link rel="stylesheet" href="ui.css">
<script type="importmap">""")
rep("""<div id="loading">Shaping the dunes…</div>""", """<div id="loading">Building the track…</div>""")
rep("""<script type="module" src="bridge.js"></script>""", """<script type="module" src="bridge.js"></script>
<script type="module" src="ui.js"></script>""")
open(hp, 'w', encoding='utf-8').write(h)
print('ui patched')
