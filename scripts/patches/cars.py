# The cars built from downloaded models (ticket #294): Jaguar XJR, Mercedes-AMG SL 63, Porsche 911 Turbo.
# Their models are public/sim/models/<key>.glb.gz, made by scripts/models/build-car.mjs from the files
# in models/ (not in git); their specs (ROAD_CARS: the real cars' figures, the body's profiles as the
# script measured them), two engine sounds, and their places in the menus and the bots' pool.
# Applies to public/sim/engine.js at the end of the chain:
#   python3 scripts/patches/cars.py <dir with engine.js>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

ROAD = """  // ---- from the models in models/ (scripts/models/build-car.mjs measures the body's profiles off them) ----
  xjr: roadSpec({
    name: 'Jaguar XJR', short: 'XJR', blurb: '4.0 supercharged V8 · 276 kW · 525 Nm · RWD · 1,775 kg',
    mass: 1775, frontWeight: 0.53, wb: 2.894, fo: 0.919, ro: 1.209, trackF: 1.494, trackR: 1.494, hpY: -0.04,
    REST: 0.22, K: 47000, tireR: 0.335, tireW: 0.236, rimR: 0.229, H: 1.434, color: 0x0f3b26, metallic: 0.6, Iw: 1.6,
    rimColor: 0xb9bdc2, rimRough: 0.25, caliper: 0x2a2c30,
    top: [[0, 0.677], [0.05, 0.807], [0.1, 0.858], [0.15, 0.892], [0.2, 0.914], [0.25, 0.93], [0.3, 0.973], [0.35, 1.128], [0.4, 1.29], [0.45, 1.366], [0.5, 1.382], [0.55, 1.39], [0.6, 1.391], [0.65, 1.383], [0.7, 1.362], [0.75, 1.256], [0.8, 1.092], [0.85, 0.982], [0.9, 0.95], [0.95, 0.912], [1, 0.542]],
    bot: [[0, 0.341], [0.05, 0.227], [0.1, 0.216], [0.15, 0.216], [0.2, 0.216], [0.25, 0.216], [0.3, 0.217], [0.35, 0.218], [0.4, 0.219], [0.45, 0.22], [0.5, 0.221], [0.55, 0.22], [0.6, 0.219], [0.65, 0.217], [0.7, 0.216], [0.75, 0.216], [0.8, 0.232], [0.85, 0.259], [0.9, 0.285], [0.95, 0.311], [1, 0.353]],
    belt: [[0, 0.677], [0.1, 0.858], [0.2, 0.914], [0.3, 0.915], [0.4, 0.943], [0.5, 0.949], [0.6, 0.948], [0.7, 0.964], [0.8, 0.987], [0.9, 0.95], [1, 0.542]],
    halfW: [[0, 0.499], [0.05, 0.838], [0.1, 0.861], [0.15, 0.886], [0.2, 0.899], [0.25, 0.898], [0.3, 0.906], [0.35, 0.909], [0.4, 0.911], [0.45, 0.911], [0.5, 0.911], [0.55, 0.91], [0.6, 0.908], [0.65, 0.905], [0.7, 0.899], [0.75, 0.908], [0.8, 0.898], [0.85, 0.865], [0.9, 0.842], [0.95, 0.809], [1, 0.678]],
    greenW: 0.69, cab: { ws: 0.3, bk: 0.8 },
    dlo: [[1.557, 0.907], [1.582, 0.887], [3.536, 0.965], [3.979, 0.987], [3.878, 1.052], [3.498, 1.195], [2.118, 1.216]],
    panes: [[[1.557, 0.907], [1.582, 0.887], [3.536, 0.965], [3.979, 0.987], [3.878, 1.052], [3.498, 1.195], [2.118, 1.216]]],
    windshield: [[-0.602, 1.471], [0.602, 1.471], [0.643, 2.739], [-0.643, 2.739]],
    backlight: [[-0.641, 2.891], [0.641, 2.891], [0.514, 4.098], [-0.514, 4.098]],
    mirror: { d: 1.707, h: 0.999, mat: 'paint' },
    exhausts: [{ x: 0.55, y: 0.27, r: 0.04 }],
    rimFace: rr => spokeFace(rr, 5, 0.12, { split: 0.05, hub: 0.07 }),
    details({ project, both, rect, roundRect, M }) {
      // four round headlamps, a mesh grille; slim tail lamps, plate
      for (const x of [0.5, 0.66]) both('front', roundRect(x, 0.6, x + 0.13, 0.72, 0.06), M.lens, 0.006);
      project('front', [[-0.3, 0.52], [0.3, 0.52], [0.34, 0.66], [-0.34, 0.66]], M.grille, 0.007);
      project('front', rect(-0.26, 0.36, 0.26, 0.47), M.plate, 0.008, { sub: 2 });
      both('rear', [[0.45, 0.78], [0.86, 0.8], [0.88, 0.9], [0.5, 0.9]], M.tail, 0.006);
      project('rear', rect(-0.26, 0.6, 0.26, 0.72), M.plate, 0.008, { sub: 2 });
    },
    engine: { idle: 650, limiter: 6250, curve: [[650, 330], [1500, 430], [2500, 500], [3600, 525], [4500, 515], [5000, 505], [5500, 478], [6150, 429], [6300, 390]], gears: [3.59, 2.19, 1.41, 1.0, 0.83], fd: 3.06, rev: 3.16, eff: 0.86, stall: 2000, upLo: 1900, upHi: 6000, upGround: 0, dnLo: 1200, dnHi: 3200 },
    cda: 0.78, brake: 4300, steerLock: 0.54, awd: false, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.255, defl: 0.03 }, { psi: 32, kpa: 221, w: 0.24, defl: 0.016 }, { psi: 40, kpa: 276, w: 0.232, defl: 0.008 }],
    sound: 'v8sc', cam: { back: 8.2, up: 2.6, hood: [0, 1.05, 0.5] },
  }),
  sl63: roadSpec({
    name: 'Mercedes-AMG SL 63', short: 'SL 63', blurb: '4.0 twin-turbo V8 · 430 kW · 800 Nm · 4MATIC+ · 1,970 kg',
    mass: 1970, frontWeight: 0.53, wb: 2.701, fo: 0.971, ro: 1.045, trackF: 1.611, trackR: 1.602, hpY: -0.03,
    REST: 0.2, K: 56000, tireR: 0.379, tireW: 0.267, rimR: 0.267, H: 1.403, color: 0x3a3d42, metallic: 0.6, Iw: 1.7,
    rimColor: 0x2a2c2f, rimRough: 0.3, caliper: 0xd9a21b,
    top: [[0, 0.723], [0.05, 0.831], [0.1, 0.896], [0.15, 0.937], [0.2, 0.965], [0.25, 0.98], [0.3, 0.991], [0.35, 0.973], [0.4, 0.961], [0.45, 1.113], [0.5, 1.245], [0.55, 1.396], [0.6, 1.401], [0.65, 1.393], [0.7, 1.364], [0.75, 1.312], [0.8, 1.212], [0.85, 1.084], [0.9, 1.04], [0.95, 0.98], [1, 0.823]],
    bot: [[0, 0.216], [0.05, 0.152], [0.1, 0.143], [0.3, 0.166], [0.35, 0.173], [0.4, 0.177], [0.45, 0.18], [0.5, 0.182], [0.55, 0.183], [0.6, 0.183], [0.65, 0.182], [0.9, 0.189], [0.95, 0.248], [1, 0.339]],
    belt: [[0, 0.723], [0.1, 0.896], [0.2, 0.965], [0.3, 0.966], [0.4, 0.961], [0.5, 0.984], [0.6, 1.007], [0.7, 1.033], [0.8, 1.157], [0.9, 1.04], [1, 0.823]],
    halfW: [[0, 0.279], [0.05, 0.825], [0.1, 0.941], [0.15, 0.957], [0.2, 0.957], [0.25, 0.958], [0.3, 0.943], [0.35, 0.932], [0.4, 0.93], [0.45, 0.929], [0.5, 0.929], [0.55, 0.928], [0.6, 0.926], [0.65, 0.928], [0.7, 0.949], [0.75, 0.957], [0.8, 0.957], [0.85, 0.959], [0.9, 0.907], [0.95, 0.806], [1, 0.423]],
    greenW: 0.586, cab: { ws: 0.425, bk: 0.825 },
    dlo: [[2.001, 0.966], [3.022, 1.016], [3.362, 1.039], [3.241, 1.062], [2.29, 1.109], [2.106, 1.098], [2.014, 1.033]],
    panes: [[[2.001, 0.966], [3.022, 1.016], [3.362, 1.039], [3.241, 1.062], [2.29, 1.109], [2.106, 1.098], [2.014, 1.033]]],
    windshield: [[-0.721, 2.15], [0.721, 2.15], [0.641, 2.91], [-0.641, 2.91]],
    backlight: [[-0.641, 2.951], [0.641, 2.951], [0.467, 3.928], [-0.467, 3.928]],
    mirror: { d: 2.099, h: 1.017, mat: 'paint' },
    exhausts: [{ x: 0.55, y: 0.33, r: 0.045 }, { x: 0.67, y: 0.33, r: 0.045 }],
    rimFace: rr => spokeFace(rr, 10, 0.08, { taper: 0.4 }),
    details({ project, both, rect, M }) {
      // slim headlights, the vertical-slat Panamericana grille; full-width tail lights
      both('front', [[0.5, 0.62], [0.84, 0.66], [0.9, 0.6], [0.56, 0.57]], M.lens, 0.006);
      project('front', [[-0.3, 0.36], [0.3, 0.36], [0.34, 0.64], [-0.34, 0.64]], M.grille, 0.007);
      both('rear', [[0.3, 0.8], [0.86, 0.82], [0.88, 0.88], [0.32, 0.86]], M.tail, 0.006);
      project('rear', rect(-0.26, 0.5, 0.26, 0.62), M.plate, 0.008, { sub: 2 });
    },
    engine: { idle: 750, limiter: 7000, curve: [[700, 450], [1500, 650], [2500, 800], [4500, 800], [5500, 745], [6500, 632], [7000, 540]], gears: [5.35, 3.24, 2.25, 1.64, 1.21, 1.0, 0.87, 0.72, 0.6], fd: 3.07, rev: 4.8, eff: 0.88, stall: 2400, upLo: 2200, upHi: 6800, upGround: 0, dnLo: 1300, dnHi: 3600 },
    cda: 0.64, brake: 5200, steerLock: 0.53, awd: true, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.285, defl: 0.028 }, { psi: 33, kpa: 228, w: 0.27, defl: 0.014 }, { psi: 41, kpa: 283, w: 0.262, defl: 0.007 }],
    sound: 'v8rs', cam: { back: 7.8, up: 2.5, hood: [0, 1.05, 0.5] },
  }),
  p911: roadSpec({
    name: 'Porsche 911 Turbo', short: '911 Turbo', blurb: '3.7 twin-turbo flat-six · 427 kW · 750 Nm · AWD · 1,640 kg',
    mass: 1640, frontWeight: 0.39, wb: 2.451, fo: 1.015, ro: 1.068, trackF: 1.557, trackR: 1.57, hpY: -0.03,
    REST: 0.19, K: 54000, tireR: 0.351, tireW: 0.276, rimR: 0.27, H: 1.308, color: 0x9a9da1, metallic: 0.6, Iw: 1.5,
    rimColor: 0x2a2c2f, rimRough: 0.3, caliper: 0xb3121b,
    top: [[0, 0.548], [0.05, 0.662], [0.1, 0.758], [0.15, 0.848], [0.2, 0.868], [0.25, 0.902], [0.3, 0.921], [0.35, 1.041], [0.4, 1.148], [0.45, 1.246], [0.5, 1.296], [0.55, 1.306], [0.6, 1.294], [0.65, 1.274], [0.7, 1.232], [0.75, 1.177], [0.8, 1.114], [0.85, 1.043], [0.9, 0.97], [0.95, 0.962], [1, 0.718]],
    bot: [[0, 0.212], [0.05, 0.177], [0.1, 0.166], [0.15, 0.166], [0.2, 0.13], [0.25, 0.159], [0.3, 0.16], [0.35, 0.151], [0.4, 0.15], [0.45, 0.149], [0.5, 0.147], [0.55, 0.146], [0.6, 0.145], [0.65, 0.144], [0.7, 0.16], [0.75, 0.14], [0.8, 0.159], [0.85, 0.163], [0.9, 0.176], [0.95, 0.2], [1, 0.273]],
    belt: [[0, 0.548], [0.1, 0.758], [0.2, 0.86], [0.3, 0.86], [0.4, 1.017], [0.5, 0.869], [0.6, 0.879], [0.7, 0.937], [0.8, 1.061], [0.9, 0.97], [1, 0.718]],
    halfW: [[0, 0.391], [0.05, 0.752], [0.1, 0.889], [0.15, 0.917], [0.2, 0.919], [0.25, 0.919], [0.3, 0.913], [0.35, 0.879], [0.4, 0.906], [0.45, 0.872], [0.5, 0.867], [0.55, 0.861], [0.6, 0.871], [0.65, 0.897], [0.7, 0.949], [0.75, 0.95], [0.8, 0.95], [0.85, 0.946], [0.9, 0.88], [0.95, 0.776], [1, 0.5]],
    greenW: 0.593, cab: { ws: 0.3, bk: 0.85 },
    dlo: [[1.609, 0.87], [1.922, 0.859], [2.479, 0.873], [2.731, 0.882], [2.277, 0.953], [1.854, 0.935], [1.622, 0.881]],
    panes: [[[1.609, 0.87], [1.922, 0.859], [2.479, 0.873], [2.731, 0.882], [2.277, 0.953], [1.854, 0.935], [1.622, 0.881]]],
    windshield: [[-0.369, 1.286], [0.369, 1.286], [0.707, 2.589], [-0.707, 2.589]],
    backlight: [[-0.704, 2.608], [0.704, 2.608], [0.49, 3.891], [-0.49, 3.891]],
    mirror: { d: 1.541, h: 0.928, mat: 'paint' },
    exhausts: [{ x: 0.42, y: 0.31, r: 0.05 }],
    rimFace: rr => spokeFace(rr, 10, 0.08, { taper: 0.4 }),
    details({ project, both, rect, roundRect, M }) {
      // round headlights on the wings, a black intake; the light bar across the tail
      both('front', roundRect(0.5, 0.6, 0.72, 0.74, 0.07), M.lens, 0.006);
      project('front', [[-0.6, 0.22], [0.6, 0.22], [0.64, 0.4], [-0.64, 0.4]], M.grille, 0.007);
      project('rear', rect(-0.8, 0.82, 0.8, 0.85), M.tail, 0.008, { sub: 1 });
      project('rear', rect(-0.26, 0.46, 0.26, 0.58), M.plate, 0.008, { sub: 2 });
    },
    engine: { idle: 800, limiter: 7200, curve: [[700, 400], [1500, 600], [2250, 750], [4500, 750], [5500, 700], [6500, 627], [7200, 540]], gears: [4.89, 3.17, 2.15, 1.56, 1.18, 0.94, 0.76, 0.61], fd: 3.39, rev: 4.55, eff: 0.88, stall: 2500, upLo: 2300, upHi: 7000, upGround: 0, dnLo: 1300, dnHi: 3800 },
    cda: 0.66, brake: 5400, steerLock: 0.52, awd: true, awdFixed: true,
    pressures: [{ psi: 22, kpa: 152, w: 0.3, defl: 0.03 }, { psi: 33, kpa: 228, w: 0.285, defl: 0.016 }, { psi: 40, kpa: 276, w: 0.275, defl: 0.008 }],
    sound: 'f6tt', cam: { back: 7.6, up: 2.4, hood: [0, 1.0, 0.5] },
  }),
"""
rep("""    sound: 'v8m', cam: { back: 7.8, up: 2.5, hood: [0, 1.05, 0.5] },
  }),
};""", """    sound: 'v8m', cam: { back: 7.8, up: 2.5, hood: [0, 1.05, 0.5] },
  }),
""" + ROAD + """};""")

SOUNDS = """  // Jaguar 4.0 V8 with an Eaton supercharger: the luxury V8's burble, no turbo hush, the blower's whine on top
  v8sc: { fire: [0, 1, 2, 3, 4, 5, 6, 7].map(k => k / 8), bank: [0, 1, 0, 1, 1, 0, 0, 1], hdr: [0.0049, 0.0055], bankPipe: [0.0098, 0.0112], coll: 0.0026, tail: 0.019, muff: [420, 2400, 1200], body: [80, 5], honk: [400, 3], pres: 1600,
    sub: [125, 4], dual: 0.6, cylVar: 0.12, rasp: 0.2, raspF: 2400,
    level: 0.86, turbo: 0, bov: 0, limiter: 6250, exW: 0.085, drive: [1.2, 2.8], intake: 0.4, mech: 0.35, whine: 0.3, burble: 0.35 },
  // Porsche 3.7 flat-six, twin turbo: even firing alternating banks, short pipes, a hard metallic edge
  f6tt: { fire: [0, 1, 2, 3, 4, 5].map(k => k / 6), bank: [0, 1, 0, 1, 0, 1], hdr: [0.005, 0.0055], coll: 0.0024, tail: 0.015, muff: [600, 3600, 1600], body: [100, 4], honk: [560, 4], pres: 1800,
    level: 0.95, turbo: 0.8, bov: 0.3, limiter: 7200, exW: 0.08, drive: [1.4, 3.0], intake: 0.45, mech: 0.7, whine: 0.12, burble: 0.4 },
"""
rep("""  v8p: { fire:""", SOUNDS + """  v8p: { fire:""")

rep("""  quattroporte: { name: ROAD_CARS.quattroporte.name, blurb: ROAD_CARS.quattroporte.blurb },
""", """  quattroporte: { name: ROAD_CARS.quattroporte.name, blurb: ROAD_CARS.quattroporte.blurb },
  xjr: { name: ROAD_CARS.xjr.name, blurb: ROAD_CARS.xjr.blurb },
  sl63: { name: ROAD_CARS.sl63.name, blurb: ROAD_CARS.sl63.blurb },
  p911: { name: ROAD_CARS.p911.name, blurb: ROAD_CARS.p911.blurb },
""")
rep("""  navigator: { hubY: 0.395, zF: 1.558, zR: -1.554, paint: 0xeeeeea, eye: [0.46, 1.43, -0.05] },
""", """  navigator: { hubY: 0.395, zF: 1.558, zR: -1.554, paint: 0xeeeeea, eye: [0.46, 1.43, -0.05] },
  // built by scripts/models/build-car.mjs (the numbers are what it prints); the XJR is right-hand drive
  xjr: { hubY: 0.335, zF: 1.447, zR: -1.447, paint: 0x0f3b26, eye: [-0.37, 1.05, -0.2] },
  sl63: { hubY: 0.379, zF: 1.35, zR: -1.35, paint: 0x0d1b3a, eye: [0.38, 1.17, -0.42] },
  p911: { hubY: 0.351, zF: 1.226, zR: -1.226, paint: 0x9a9da1, eye: [0.34, 1.08, -0.27] },
""")
rep("""const BOT_CARS = ['rs6', 'supra', 'cayenne', 'bmw7', 'quattroporte', 'x7', 'navigator'],""",
    """const BOT_CARS = ['rs6', 'supra', 'cayenne', 'bmw7', 'quattroporte', 'x7', 'navigator', 'p911', 'sl63', 'xjr'],""")

open(ep, 'w').write(s)
print('cars patched')
