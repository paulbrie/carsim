# The cars built from downloaded models (ticket #294): Jaguar XJR, Mercedes-AMG SL 63, Porsche 911 Turbo; (#313):
# Porsche Cayenne Turbo S, Ford Mustang Shelby GT500, BMW X5 M Competition, Mercedes-AMG GLE 63 S Coupé.
# Their models are public/sim/models/<key>.glb.gz, made by scripts/models/build-car.mjs from the files
# in models/ (not in git); their specs (ROAD_CARS: the real cars' figures, the body's profiles as the
# script measured them), their engine sounds (and the parts of the synth the flat-six needs), and their places in
# the menus and the bots' pool.
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
  cayennets: roadSpec({
    name: 'Porsche Cayenne Turbo S', short: 'Cayenne Turbo S', blurb: '4.8 twin-turbo V8 · 404 kW · 750 Nm · AWD · 2,355 kg',
    mass: 2355, frontWeight: 0.56, wb: 2.85, fo: 0.94, ro: 1.004, trackF: 1.7, trackR: 1.7, hpY: -0.1,
    REST: 0.24, K: 54000, tireR: 0.37, tireW: 0.298, rimR: 0.267, H: 1.672, color: 0x4a3a2c, metallic: 0.6, Iw: 2.1,
    rimColor: 0xb9bdc2, rimRough: 0.22, caliper: 0xd9a21b,
    top: [[0, 0.784], [0.05, 0.942], [0.1, 1.02], [0.15, 1.077], [0.2, 1.115], [0.25, 1.159], [0.3, 1.224], [0.35, 1.368], [0.4, 1.502], [0.45, 1.611], [0.5, 1.646], [0.55, 1.661], [0.6, 1.669], [0.65, 1.671], [0.7, 1.669], [0.75, 1.664], [0.8, 1.655], [0.85, 1.633], [0.9, 1.604], [0.95, 1.318], [1, 0.606]],
    bot: [[0, 0.4], [0.05, 0.257], [0.1, 0.183], [0.15, 0.183], [0.2, 0.163], [0.25, 0.12], [0.3, 0.129], [0.35, 0.167], [0.4, 0.179], [0.45, 0.179], [0.5, 0.173], [0.55, 0.169], [0.6, 0.167], [0.65, 0.164], [0.7, 0.171], [0.75, 0.159], [0.8, 0.13], [0.85, 0.167], [0.9, 0.209], [0.95, 0.268], [1, 0.39]],
    belt: [[0, 0.784], [0.1, 1.02], [0.2, 1.061], [0.3, 1.085], [0.4, 1.094], [0.5, 1.11], [0.6, 1.122], [0.7, 1.136], [0.8, 1.154], [0.9, 1.445], [1, 0.606]],
    halfW: [[0, 0.38], [0.05, 0.89], [0.1, 0.97], [0.15, 0.988], [0.2, 0.994], [0.25, 0.998], [0.3, 0.956], [0.35, 0.947], [0.4, 0.949], [0.45, 0.953], [0.5, 0.954], [0.55, 0.955], [0.6, 0.956], [0.65, 0.955], [0.7, 0.975], [0.75, 0.989], [0.8, 0.989], [0.85, 0.994], [0.9, 0.977], [0.95, 0.924], [1, 0.662]],
    greenW: 0.669, cab: { ws: 0.275, bk: 0.95 },
    dlo: [[1.427, 1.064], [3.488, 1.141], [3.976, 1.169], [4.077, 1.253], [3.522, 1.373], [2.032, 1.415], [1.601, 1.201]],
    panes: [[[1.427, 1.064], [3.488, 1.141], [3.976, 1.169], [4.077, 1.253], [3.522, 1.373], [2.032, 1.415], [1.601, 1.201]]],
    windshield: [[-0.484, 1.234], [0.484, 1.234], [0.732, 2.852], [-0.732, 2.852]],
    backlight: [[-0.723, 3.139], [0.723, 3.139], [0.558, 4.595], [-0.558, 4.595]],
    mirror: { d: 1.51, h: 1.239, mat: 'paint' },
    exhausts: [{ x: 0.5, y: 0.3, r: 0.045 }, { x: 0.62, y: 0.3, r: 0.045 }],
    rimFace: rr => spokeFace(rr, 5, 0.15, { split: 0.06, hub: 0.07 }),
    details({ project, both, rect, roundRect, M }) {
      // teardrop headlights, the wide lower intakes of the Turbo; tall tail lights at the corners
      both('front', roundRect(0.5, 0.8, 0.86, 0.98, 0.07), M.lens, 0.006);
      project('front', [[-0.62, 0.36], [0.62, 0.36], [0.66, 0.66], [-0.66, 0.66]], M.grille, 0.007);
      both('rear', rect(0.6, 0.84, 0.92, 1.04), M.tail, 0.006);
      project('rear', rect(-0.26, 0.66, 0.26, 0.78), M.plate, 0.008, { sub: 2 });
    },
    engine: { idle: 650, limiter: 6700, curve: [[600, 400], [1500, 620], [2250, 750], [4500, 750], [5500, 700], [6000, 643], [6700, 540]], gears: [4.15, 2.37, 1.56, 1.16, 0.86, 0.69], fd: 3.55, rev: 3.39, eff: 0.87, stall: 2200, upLo: 2000, upHi: 6400, upGround: 0, dnLo: 1200, dnHi: 3400 },
    cda: 1.0, brake: 5200, steerLock: 0.54, awd: true, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.32, defl: 0.032 }, { psi: 30, kpa: 207, w: 0.305, defl: 0.018 }, { psi: 38, kpa: 262, w: 0.295, defl: 0.008 }],
    sound: 'v8p', cam: { back: 7.9, up: 2.8, hood: [0, 1.2, 0.5] },
  }),
  gt500: roadSpec({
    name: 'Ford Mustang Shelby GT500', short: 'GT500', blurb: '5.2 supercharged V8 · 567 kW · 847 Nm · RWD · 1,916 kg',
    mass: 1916, frontWeight: 0.56, wb: 2.732, fo: 0.975, ro: 1.122, trackF: 1.662, trackR: 1.662, hpY: -0.03,
    REST: 0.2, K: 56000, tireR: 0.354, tireW: 0.271, rimR: 0.26, H: 1.36, color: 0x12407c, metallic: 0.6, Iw: 1.8,
    rimColor: 0x1c1d1f, rimRough: 0.35, caliper: 0xb3121b,
    top: [[0, 0.182], [0.05, 0.841], [0.1, 0.924], [0.15, 0.961], [0.2, 0.981], [0.25, 0.987], [0.3, 1.004], [0.35, 1.037], [0.4, 1.16], [0.45, 1.268], [0.5, 1.34], [0.55, 1.36], [0.6, 1.354], [0.65, 1.331], [0.7, 1.289], [0.75, 1.231], [0.8, 1.163], [0.85, 1.091], [0.9, 1.119], [0.95, 1.127], [1, 0.696]],
    bot: [[0, 0.145], [0.05, 0.137], [0.1, 0.127], [0.15, 0.128], [0.2, 0.132], [0.25, 0.135], [0.3, 0.134], [0.35, 0.135], [0.4, 0.136], [0.45, 0.136], [0.5, 0.137], [0.55, 0.136], [0.6, 0.136], [0.65, 0.136], [0.7, 0.138], [0.75, 0.144], [0.8, 0.15], [0.85, 0.156], [0.9, 0.161], [0.95, 0.175], [1, 0.268]],
    belt: [[0, 0.182], [0.1, 0.919], [0.2, 0.919], [0.3, 0.919], [0.4, 1.063], [0.5, 0.957], [0.6, 0.965], [0.7, 0.995], [0.8, 1.102], [0.9, 1.023], [1, 0.696]],
    halfW: [[0, 0.468], [0.05, 0.899], [0.1, 0.961], [0.15, 0.96], [0.2, 0.972], [0.25, 0.972], [0.3, 0.945], [0.35, 0.948], [0.4, 0.951], [0.45, 0.915], [0.5, 0.913], [0.55, 0.909], [0.6, 0.926], [0.65, 0.91], [0.7, 0.946], [0.75, 0.956], [0.8, 0.957], [0.85, 0.954], [0.9, 0.882], [0.95, 0.818], [1, 0.451]],
    greenW: 0.612, cab: { ws: 0.325, bk: 0.875 },
    dlo: [[1.699, 0.915], [3.018, 0.967], [3.406, 1.002], [3.046, 1.059], [2.487, 1.051], [2.01, 1.037], [1.866, 1.026]],
    panes: [[[1.699, 0.915], [3.018, 0.967], [3.406, 1.002], [3.046, 1.059], [2.487, 1.051], [2.01, 1.037], [1.866, 1.026]]],
    windshield: [[-0.464, 1.521], [0.464, 1.521], [0.695, 2.863], [-0.695, 2.863]],
    backlight: [[-0.695, 2.938], [0.695, 2.938], [0.402, 4.243], [-0.402, 4.243]],
    mirror: { d: 2.019, h: 0.972, mat: 'paint' },
    exhausts: [{ x: 0.5, y: 0.27, r: 0.05 }, { x: 0.63, y: 0.27, r: 0.05 }],
    rimFace: rr => spokeFace(rr, 10, 0.09, { taper: 0.4 }),
    details({ project, both, rect, M }) {
      // slanted headlights either side of the big black grille; three-bar tail lights
      both('front', [[0.52, 0.62], [0.86, 0.66], [0.88, 0.74], [0.56, 0.72]], M.lens, 0.006);
      project('front', [[-0.56, 0.3], [0.56, 0.3], [0.5, 0.68], [-0.5, 0.68]], M.grille, 0.007);
      both('rear', rect(0.42, 0.72, 0.78, 0.9), M.tail, 0.006);
      project('rear', rect(-0.26, 0.42, 0.26, 0.54), M.plate, 0.008, { sub: 2 });
    },
    engine: { idle: 750, limiter: 7500, curve: [[700, 520], [1500, 640], [2500, 750], [4000, 820], [5000, 847], [6000, 830], [7300, 742], [7600, 690]], gears: [3.25, 2.23, 1.61, 1.24, 1.0, 0.79, 0.63], fd: 3.73, rev: 2.96, eff: 0.9, stall: 2500, upLo: 2300, upHi: 7300, upGround: 0, dnLo: 1300, dnHi: 3900 },
    cda: 0.8, brake: 5200, steerLock: 0.54, awd: false, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.295, defl: 0.028 }, { psi: 32, kpa: 221, w: 0.28, defl: 0.014 }, { psi: 40, kpa: 276, w: 0.27, defl: 0.007 }],
    sound: 'v8gt', cam: { back: 7.4, up: 2.4, hood: [0, 1.02, 0.45] },
  }),
  x5m: roadSpec({
    name: 'BMW X5 M Competition', short: 'X5 M', blurb: '4.4 twin-turbo V8 · 460 kW · 750 Nm · M xDrive · 2,310 kg',
    mass: 2310, frontWeight: 0.53, wb: 2.971, fo: 0.899, ro: 1.077, trackF: 1.728, trackR: 1.728, hpY: -0.12,
    REST: 0.24, K: 56000, tireR: 0.374, tireW: 0.324, rimR: 0.27, H: 1.779, color: 0x1c4f91, metallic: 0.6, Iw: 2.2,
    rimColor: 0x8c9196, rimRough: 0.25, caliper: 0xa0731a,
    top: [[0, 0.911], [0.05, 1.04], [0.1, 1.099], [0.15, 1.143], [0.2, 1.174], [0.25, 1.199], [0.3, 1.283], [0.35, 1.45], [0.4, 1.594], [0.45, 1.684], [0.5, 1.718], [0.55, 1.736], [0.6, 1.747], [0.65, 1.749], [0.7, 1.746], [0.75, 1.737], [0.8, 1.758], [0.85, 1.702], [0.9, 1.665], [0.95, 1.321], [1, 0.621]],
    bot: [[0, 0.243], [0.05, 0.177], [0.1, 0.198], [0.15, 0.185], [0.2, 0.223], [0.25, 0.225], [0.3, 0.226], [0.35, 0.23], [0.4, 0.233], [0.45, 0.236], [0.5, 0.239], [0.55, 0.242], [0.6, 0.246], [0.65, 0.249], [0.7, 0.253], [0.75, 0.271], [0.8, 0.288], [0.85, 0.306], [0.9, 0.303], [0.95, 0.357], [1, 0.386]],
    belt: [[0, 0.911], [0.1, 1.099], [0.2, 1.145], [0.3, 1.158], [0.4, 1.134], [0.5, 1.165], [0.6, 1.193], [0.7, 1.224], [0.8, 1.273], [0.9, 1.561], [1, 0.621]],
    halfW: [[0, 0.509], [0.05, 0.941], [0.1, 1.008], [0.15, 1.019], [0.2, 1.02], [0.25, 1.014], [0.3, 1.003], [0.35, 1.006], [0.4, 0.996], [0.45, 0.997], [0.5, 0.997], [0.55, 0.996], [0.6, 0.995], [0.65, 0.994], [0.7, 1.007], [0.75, 1.031], [0.8, 1.028], [0.85, 1.018], [0.9, 0.972], [0.95, 0.903], [1, 0.534]],
    greenW: 0.632, cab: { ws: 0.275, bk: 0.95 },
    dlo: [[1.495, 1.158], [1.796, 1.121], [3.76, 1.25], [4.096, 1.321], [3.843, 1.365], [2.845, 1.431], [2.162, 1.409]],
    panes: [[[1.495, 1.158], [1.796, 1.121], [3.76, 1.25], [4.096, 1.321], [3.843, 1.365], [2.845, 1.431], [2.162, 1.409]]],
    windshield: [[-0.584, 1.324], [0.584, 1.324], [0.477, 3.022], [-0.477, 3.022]],
    backlight: [[-0.721, 3.19], [0.721, 3.19], [0.685, 4.715], [-0.685, 4.715]],
    mirror: { d: 1.558, h: 1.304, mat: 'paint' },
    rails: { d0: 2.2, d1: 4.2, x: 0.64, mat: 'black' },
    exhausts: [{ x: 0.5, y: 0.3, r: 0.05 }, { x: 0.63, y: 0.3, r: 0.05 }],
    rimFace: rr => spokeFace(rr, 7, 0.085, { split: 0.05, hub: 0.075 }),
    details({ project, both, rect, M }) {
      // slim headlights and the twin kidneys; L-shaped tail lights
      both('front', [[0.5, 0.84], [0.88, 0.88], [0.9, 0.96], [0.52, 0.94]], M.lens, 0.006);
      both('front', [[0.04, 0.62], [0.38, 0.62], [0.4, 0.92], [0.04, 0.92]], M.grille, 0.007);
      both('rear', [[0.34, 1.0], [0.9, 1.02], [0.92, 1.1], [0.36, 1.08]], M.tail, 0.006);
      project('rear', rect(-0.26, 0.74, 0.26, 0.86), M.plate, 0.008, { sub: 2 });
    },
    engine: { idle: 650, limiter: 7200, curve: [[600, 450], [1500, 700], [1800, 750], [5800, 750], [6000, 732], [6600, 650], [7300, 550]], gears: [5.0, 3.2, 2.143, 1.72, 1.313, 1.0, 0.823, 0.64], fd: 3.154, rev: 3.478, eff: 0.88, stall: 2200, upLo: 2000, upHi: 6900, upGround: 0, dnLo: 1200, dnHi: 3500 },
    cda: 1.05, brake: 5600, steerLock: 0.53, awd: true, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.345, defl: 0.032 }, { psi: 32, kpa: 221, w: 0.33, defl: 0.017 }, { psi: 40, kpa: 276, w: 0.32, defl: 0.008 }],
    sound: 'v8bm', cam: { back: 8.2, up: 2.9, hood: [0, 1.3, 0.5] },
  }),
  gle63: roadSpec({
    name: 'Mercedes-AMG GLE 63 S Coupé', short: 'GLE 63', blurb: '4.0 twin-turbo V8 · 450 kW · 850 Nm · 4MATIC+ · 2,445 kg',
    mass: 2445, frontWeight: 0.55, wb: 2.919, fo: 0.912, ro: 1.07, trackF: 1.669, trackR: 1.669, hpY: -0.12,
    REST: 0.24, K: 57000, tireR: 0.406, tireW: 0.336, rimR: 0.279, H: 1.735, color: 0x7a1218, metallic: 0.6, Iw: 2.4,
    rimColor: 0x1c1d1f, rimRough: 0.3, caliper: 0x9a1616,
    top: [[0, 0.987], [0.05, 1.11], [0.1, 1.165], [0.15, 1.209], [0.2, 1.247], [0.25, 1.266], [0.3, 1.364], [0.35, 1.51], [0.4, 1.625], [0.45, 1.699], [0.5, 1.727], [0.55, 1.734], [0.6, 1.732], [0.65, 1.723], [0.7, 1.704], [0.75, 1.673], [0.8, 1.616], [0.85, 1.52], [0.9, 1.44], [0.95, 1.361], [1, 1.051]],
    bot: [[0, 0.288], [0.05, 0.278], [0.1, 0.28], [0.15, 0.28], [0.2, 0.281], [0.25, 0.281], [0.3, 0.278], [0.35, 0.282], [0.4, 0.286], [0.45, 0.29], [0.5, 0.293], [0.55, 0.297], [0.6, 0.301], [0.65, 0.305], [0.7, 0.314], [0.75, 0.329], [0.8, 0.344], [0.85, 0.36], [0.9, 0.374], [0.95, 0.396], [1, 0.427]],
    belt: [[0, 0.987], [0.1, 1.135], [0.2, 1.135], [0.3, 1.285], [0.4, 1.21], [0.5, 1.239], [0.6, 1.257], [0.7, 1.265], [0.8, 1.288], [0.9, 1.348], [1, 1.051]],
    halfW: [[0, 0.43], [0.05, 0.882], [0.1, 0.958], [0.15, 0.974], [0.2, 0.978], [0.25, 0.974], [0.3, 0.951], [0.35, 0.979], [0.4, 0.979], [0.45, 0.979], [0.5, 0.978], [0.55, 0.977], [0.6, 0.976], [0.65, 0.953], [0.7, 0.963], [0.75, 0.991], [0.8, 0.994], [0.85, 0.994], [0.9, 0.963], [0.95, 0.884], [1, 0.529]],
    greenW: 0.585, cab: { ws: 0.25, bk: 0.95 },
    dlo: [[1.235, 1.126], [3.703, 1.272], [4.027, 1.303], [3.981, 1.338], [3.106, 1.422], [2.69, 1.435], [1.832, 1.424]],
    panes: [[[1.235, 1.126], [3.703, 1.272], [4.027, 1.303], [3.981, 1.338], [3.106, 1.422], [2.69, 1.435], [1.832, 1.424]]],
    windshield: [[-0.741, 1.16], [0.741, 1.16], [0.653, 2.818], [-0.653, 2.818]],
    backlight: [[-0.656, 3.019], [0.656, 3.019], [0.349, 4.668], [-0.349, 4.668]],
    mirror: { d: 1.741, h: 1.285, mat: 'paint' },
    exhausts: [{ x: 0.52, y: 0.32, shape: 'trap', w: 0.11, h: 0.07 }, { x: 0.68, y: 0.32, shape: 'trap', w: 0.11, h: 0.07 }],
    rimFace: rr => spokeFace(rr, 10, 0.08, { taper: 0.4 }),
    details({ project, both, rect, M }) {
      // slim headlights, the vertical-slat Panamericana grille; narrow tail lights under the sloping tailgate
      both('front', [[0.52, 0.84], [0.88, 0.88], [0.9, 0.96], [0.56, 0.94]], M.lens, 0.006);
      project('front', [[-0.44, 0.6], [0.44, 0.6], [0.5, 0.94], [-0.5, 0.94]], M.grille, 0.007);
      both('rear', [[0.34, 1.06], [0.9, 1.08], [0.92, 1.15], [0.36, 1.13]], M.tail, 0.006);
      project('rear', rect(-0.26, 0.58, 0.26, 0.7), M.plate, 0.008, { sub: 2 });
    },
    engine: { idle: 700, limiter: 7000, curve: [[700, 480], [1500, 700], [2250, 850], [5000, 850], [5750, 747], [6500, 661], [7100, 560]], gears: [5.35, 3.24, 2.25, 1.64, 1.21, 1.0, 0.87, 0.72, 0.6], fd: 3.27, rev: 4.8, eff: 0.88, stall: 2300, upLo: 2100, upHi: 6700, upGround: 0, dnLo: 1250, dnHi: 3500 },
    cda: 1.02, brake: 5600, steerLock: 0.52, awd: true, awdFixed: true,
    pressures: [{ psi: 20, kpa: 138, w: 0.355, defl: 0.034 }, { psi: 32, kpa: 221, w: 0.34, defl: 0.018 }, { psi: 40, kpa: 276, w: 0.33, defl: 0.008 }],
    sound: 'v8rs', cam: { back: 8.2, up: 2.9, hood: [0, 1.3, 0.5] },
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
  // Porsche 3.7 flat-six, twin turbo: three cylinders a side, each bank through its own short manifold, turbo and
  // pipe, never quite alike (the boxer's half-order growl, wide in stereo); the firing note leads all the way up
  // the revs (pipes too short to cancel it), deep rather than buzzy, with the turbos' rush over it under boost
  f6tt: { fire: [0, 1, 2, 3, 4, 5].map(k => k / 6), bank: [0, 1, 0, 1, 0, 1], hdr: [0.00105, 0.0012], hdrRef: [0.4, 0.25], bankPipe: [0.0023, 0.0026], coll: 0.0019, tail: 0.0125, muff: [500, 3000, 1600], body: [75, 5], honk: [900, 3], pres: 1500,
    sub: [110, 4], dual: 0.5, cylVar: 0.12, rasp: 0.2, raspF: 1900, rush: 0.5,
    level: 0.95, turbo: 0.8, bov: 0.3, limiter: 7200, exW: 0.11, drive: [1.3, 2.7], intake: 0.35, mech: 0.7, whine: 0.05, burble: 0.3 },
  // Ford 5.2 "Predator" V8 with a big Eaton supercharger: a loud cross-plane V8 that revs to 7500, hard-edged, the blower's whine over it
  v8gt: { fire: [0, 1, 2, 3, 4, 5, 6, 7].map(k => k / 8), bank: [0, 1, 0, 1, 1, 0, 0, 1], hdr: [0.0045, 0.0051], bankPipe: [0.0082, 0.0095], coll: 0.0023, tail: 0.016, muff: [700, 4600, 2200], body: [88, 6], honk: [520, 4], pres: 1900,
    sub: [135, 4], dual: 0.9, cylVar: 0.16, rasp: 0.45, raspF: 2600,
    level: 1.1, turbo: 0, bov: 0, limiter: 7500, exW: 0.095, drive: [1.8, 4.0], intake: 0.5, mech: 0.45, whine: 0.32, burble: 0.7 },
  // BMW M's 4.4 hot-V V8 (S63) behind a sports exhaust: the luxury V8's deep burble, louder and sharper, revving to 7200
  v8bm: { fire: [0, 1, 2, 3, 4, 5, 6, 7].map(k => k / 8), bank: [0, 1, 0, 1, 1, 0, 0, 1], hdr: [0.005, 0.0056], bankPipe: [0.0098, 0.0112], coll: 0.0026, tail: 0.019, muff: [460, 2900, 1400], body: [78, 6], honk: [400, 3], pres: 1600,
    sub: [120, 4], dual: 0.6, cylVar: 0.13, rasp: 0.22, raspF: 2400,
    level: 0.92, turbo: 0.7, bov: 0.3, limiter: 7200, exW: 0.085, drive: [1.4, 3.2], intake: 0.33, mech: 0.35, whine: 0.06, burble: 0.5 },
"""
rep("""  v8p: { fire:""", SOUNDS + """  v8p: { fire:""")

# The synth's parts the flat-six needs (ticket #303), all optional so the other engines sound as they did:
# `hdrRef` [reflection, damping] of the manifolds (a turbine at the end of a short one reflects less than an
# open collector), `rush` the air and gas through the turbos under boost, breathing with the firing pulses.
rep("""    this.hdrL = new Pipe(c.hdr[0], 0.62, 0.55); this.hdrR = new Pipe(c.hdr[1], 0.62, 0.55);
""", """    const hr = c.hdrRef || [0.62, 0.55];   // how much the manifolds' ends reflect, and how dully: a turbine reflects less
    this.hdrL = new Pipe(c.hdr[0], hr[0], hr[1]); this.hdrR = new Pipe(c.hdr[1], hr[0], hr[1]);
""")
rep("""    this.cyl = c.fire.map((_, i) => 1 + (c.cylVar || 0) * Math.sin(i * 2.4 + 0.7));
""", """    this.cyl = c.fire.map((_, i) => 1 + (c.cylVar || 0) * Math.sin(i * 2.4 + 0.7));
    // optional: the rush of air and gas through the turbos under boost, breathing with the firing pulses
    this.rushF = new Biquad(); this.rushLp = new Biquad().set('lp', 2600, 0.6); this.rushE = 0;
""")
rep("""    this.whoosh.set('bp', 1600 + 2600 * this.spool, 1.1);
""", """    this.whoosh.set('bp', 1600 + 2600 * this.spool, 1.1);
    const rushA = c.rush ? c.rush * this.spool * (0.25 + 0.75 * load) * (0.5 + 0.5 * rn) : 0;
    if (rushA) this.rushF.set('bp', 480 + 700 * this.spool * rn, 0.45);
""")
rep("""        if (this.bov > 0.01) { const fl""", """        if (rushA > 0.0004) { this.rushE += (Math.min(Math.abs(raw), 1.5) - this.rushE) * 0.012; turbo += this.rushLp.run(this.rushF.run(n)) * rushA * (1.4 + 3.2 * this.rushE); }
        if (this.bov > 0.01) { const fl""")

rep("""  quattroporte: { name: ROAD_CARS.quattroporte.name, blurb: ROAD_CARS.quattroporte.blurb },
""", """  quattroporte: { name: ROAD_CARS.quattroporte.name, blurb: ROAD_CARS.quattroporte.blurb },
  xjr: { name: ROAD_CARS.xjr.name, blurb: ROAD_CARS.xjr.blurb },
  sl63: { name: ROAD_CARS.sl63.name, blurb: ROAD_CARS.sl63.blurb },
  p911: { name: ROAD_CARS.p911.name, blurb: ROAD_CARS.p911.blurb },
  cayennets: { name: ROAD_CARS.cayennets.name, blurb: ROAD_CARS.cayennets.blurb },
  gt500: { name: ROAD_CARS.gt500.name, blurb: ROAD_CARS.gt500.blurb },
  x5m: { name: ROAD_CARS.x5m.name, blurb: ROAD_CARS.x5m.blurb },
  gle63: { name: ROAD_CARS.gle63.name, blurb: ROAD_CARS.gle63.blurb },
""")
rep("""  navigator: { hubY: 0.395, zF: 1.558, zR: -1.554, paint: 0xeeeeea, eye: [0.46, 1.43, -0.05] },
""", """  navigator: { hubY: 0.395, zF: 1.558, zR: -1.554, paint: 0xeeeeea, eye: [0.46, 1.43, -0.05] },
  // built by scripts/models/build-car.mjs (the numbers are what it prints); the XJR is right-hand drive
  xjr: { hubY: 0.335, zF: 1.447, zR: -1.447, paint: 0x0f3b26, eye: [-0.37, 1.05, -0.2] },
  sl63: { hubY: 0.379, zF: 1.35, zR: -1.35, paint: 0x0d1b3a, eye: [0.38, 1.17, -0.42] },
  p911: { hubY: 0.351, zF: 1.226, zR: -1.226, paint: 0x9a9da1, eye: [0.34, 1.08, -0.27] },
  cayennets: { hubY: 0.37, zF: 1.425, zR: -1.425, paint: 0x4a3a2c, eye: [0.42, 1.36, -0.2] },
  gt500: { hubY: 0.354, zF: 1.366, zR: -1.366, paint: 0x12407c, eye: [0.38, 1.1, -0.34] },
  x5m: { hubY: 0.374, zF: 1.486, zR: -1.486, paint: 0x1c4f91, eye: [0.41, 1.4, -0.18] },
  gle63: { hubY: 0.406, zF: 1.459, zR: -1.459, paint: 0x7a1218, eye: [0.45, 1.42, -0.07] },
""")
rep("""const BOT_CARS = ['rs6', 'supra', 'cayenne', 'bmw7', 'quattroporte', 'x7', 'navigator'],""",
    """const BOT_CARS = ['rs6', 'supra', 'cayenne', 'bmw7', 'quattroporte', 'x7', 'navigator', 'p911', 'sl63', 'xjr', 'gt500', 'x5m', 'gle63', 'cayennets'],""")

# a wheel made of several materials (tyre, rim, chrome, badge) loads as a group spinLF with meshes spinLF_1, spinLF_2…:
# take the group (the first one found), not the last mesh, or only that mesh turns and the rest stays on the body (#299)
rep("""  const parts = {}; root.traverse(o => { if (/^(spin|stat)[LR][FB]/.test(o.name)) parts[o.name.slice(0, 6)] = o; });""",
    """  const parts = {}; root.traverse(o => { if (/^(spin|stat)[LR][FB]/.test(o.name)) parts[o.name.slice(0, 6)] ??= o; });   // the first: a wheel of several materials loads as a group spinLF of meshes spinLF_1… (#299)""")

# cut-out textures (badges, a mesh grille: materials named decal_*, MASK in the glTF) keep their holes; everything else that is
# not glass is still made opaque (game models often carry a stray alpha channel)
rep("""      if (!glassy) { m.transparent = false; m.opacity = 1; m.alphaTest = 0; m.depthWrite = true; m.side = THREE.DoubleSide; }""",
    """      if (!glassy) { m.transparent = false; m.opacity = 1; m.alphaTest = /^decal_/.test(n) && m.map ? 0.5 : 0; m.depthWrite = true; m.side = THREE.DoubleSide; }""")

open(ep, 'w').write(s)
print('cars patched')
