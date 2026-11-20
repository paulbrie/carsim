# The driver's-seat camera of the detailed models sits further forward (and a touch higher, looking a
# touch lower), so more of the road shows over the dashboard (ticket #285).
# Applies to public/sim/engine.js after the other patches:
#   python3 scripts/patches/cameras.py <dir with engine.js>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

# measured on the four models: the steering-wheel rim is 0.45-0.58 m ahead of the eyes and its top
# 0.1-0.2 m below them, so 0.3 m forward stays clear of it (the camera's near plane is 0.1 m)
rep("""  V.cam.driver = [eye[0], eye[1] + dy, eye[2] + dz]; V.winGlass = [];""",
    """  V.cam.driver = [eye[0], eye[1] + dy + DRIVER_CAM.up, eye[2] + dz + DRIVER_CAM.fwd]; V.winGlass = [];""")
rep("""function attachModel(V, root, D) {""", """const DRIVER_CAM = { fwd: 0.3, up: 0.05, pitch: -0.065 };   // from the driver's eyes: metres forward / up, radians down
function attachModel(V, root, D) {""")
rep("""    camera.rotateX(inside ? -0.04 : -0.08);""", """    camera.rotateX(inside ? DRIVER_CAM.pitch : -0.08);""")

open(ep, 'w').write(s)
print('cameras patched')
