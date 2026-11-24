# The car's setup (#332): what a driver may change on the car, behind one small interface (`SETUP`, `__sim.setup`)
# for the sim page's Car setup drawer (public/sim/ui.js):
#   - the drive: the buggy's front axle (rear-wheel or four-wheel drive, 4 as before), and for any car driving all
#     four the front's share of the torque, now any 5 % from 0 to 100 (the 4 key still goes round 50/40/30/20);
#   - the tires' pressure: one of the car's three (Shift+P as before);
#   - both kept per car in this browser (sandbuggy.split as before; sandbuggy.setup: { car: { p, awd } }), and put
#     back when the car is picked again; only what differs from the car's own is kept;
#   - `tireFigures`: what the tire model makes of a pressure on the ground under the car (stepCar's own sums), and
#     each wheel's sideways force (`W.fy`) beside `W.fx`, for the drawer's picture of the grip each tire spends;
#   - a training under way starts again when the setup changes (its workers have the car as it was), and the
#     lab's best is examined again after a change of pressure or of the buggy's drive, as it was for the split.
# Applies to public/sim/engine.js and index.html after the other patches (last in the chain):
#   python3 scripts/patches/setup.py <dir with engine.js and index.html>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep, encoding='utf-8').read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

# ---- the keys: through the same setters as the drawer (kept, and a training restarted)
rep("""  if (e.code === 'KeyP' && e.shiftKey) car.pIdx = (car.pIdx + 1) % PRESSURES.length;""",
    """  if (e.code === 'KeyP' && e.shiftKey) { setPressure((car.pIdx + 1) % PRESSURES.length); flash(`Tires: ${PRESSURES[car.pIdx].psi} psi${car.pIdx === VEH.pIdx ? ' (its own)' : ''} · Shift+P changes it`, '#fff', 1.8); }""")
rep("""      car.split = SPLITS[(SPLITS.indexOf(car.split) + 1) % SPLITS.length];
      try { const m = JSON.parse(localStorage.getItem('sandbuggy.split') || '{}'); if (car.split === (VEH.split ?? 0.5)) delete m[VEH.key]; else m[VEH.key] = car.split; localStorage.setItem('sandbuggy.split', JSON.stringify(m)); } catch (err) { }
""", """      setSplit(SPLITS[(SPLITS.indexOf(car.split) + 1) % SPLITS.length]);
""")
rep("""    } else if (VEH.awdFixed) flash('Rear-wheel drive only', '#fff', 1.5); else car.awd = !car.awd;""",
    """    } else if (VEH.awdFixed) flash('Rear-wheel drive only', '#fff', 1.5); else { setDrive(!car.awd); flash(car.awd ? 'Four-wheel drive' : 'Rear-wheel drive', '#fff', 1.5); }""")

# ---- the setup itself, where the split's was
rep("""const SPLITS = [0.5, 0.4, 0.3, 0.2];
function carSplit(V) {
  try { const v = JSON.parse(localStorage.getItem('sandbuggy.split') || '{}')[V.key]; if (SPLITS.includes(v)) return v; } catch (e) { }
  return V.split ?? 0.5;
}
""", """const SPLITS = [0.5, 0.4, 0.3, 0.2];                                 // (the 4 key's round; the Car setup drawer sets any 5 %)
function carSplit(V) {
  try { const v = JSON.parse(localStorage.getItem('sandbuggy.split') || '{}')[V.key]; if (typeof v === 'number' && v >= 0 && v <= 1) return v; } catch (e) { }
  return V.split ?? 0.5;
}
// ---------- the car's setup (#332): the drive, the split, the tires' pressure; this browser's choice for each car ----------
const setupOf = V => { try { return (JSON.parse(localStorage.getItem('sandbuggy.setup') || '{}') || {})[V.key] || {}; } catch (e) { return {}; } };
const carPressure = V => { const p = setupOf(V).p; return Number.isInteger(p) && V.pressures[p] ? p : V.pIdx; };
const carDrive = V => V.awdFixed ? V.awd : !!(setupOf(V).awd ?? V.awd);
function setupKeep(store, fn) { try { const m = JSON.parse(localStorage.getItem(store) || '{}') || {}; fn(m); localStorage.setItem(store, JSON.stringify(m)); } catch (e) { } }
function setupKeepOwn(k, v, own) { setupKeep('sandbuggy.setup', m => { const o = m[VEH.key] || {}; if (v === own) delete o[k]; else o[k] = v; if (Object.keys(o).length) m[VEH.key] = o; else delete m[VEH.key]; }); }
// a training under way has the car as it was (its workers too): it starts again with the car as it is
const setupChanged = () => { if (AI.training) { aiTrain(false); aiTrain(true); } return true; };
function setSplit(v) {                                               // the front's share of the torque, 0 to 1 in steps of 5 %
  if (!car.awd || !(v >= 0 && v <= 1)) return false;
  v = Math.round(v * 20) / 20; if (v === car.split) return true;
  car.split = v; setupKeep('sandbuggy.split', m => { if (v === (VEH.split ?? 0.5)) delete m[VEH.key]; else m[VEH.key] = v; });
  return setupChanged();
}
function setDrive(awd) {                                             // the front axle driven or not (not on the cars built one way)
  awd = !!awd; if (VEH.awdFixed) return false; if (awd === car.awd) return true;
  car.awd = awd; setupKeepOwn('awd', awd, !!VEH.awd);
  return setupChanged();
}
function setPressure(i) {                                            // one of the car's pressures
  if (!PRESSURES[i]) return false; if (i === car.pIdx) return true;
  car.pIdx = i; setupKeepOwn('p', i, VEH.pIdx);
  return setupChanged();
}
// what the tire model makes of a pressure: one wheel carrying its share of the car at rest, on the ground under the
// car as built (c: how packed, 0 fresh). The same sums as stepCar's: change them there, change them here.
function tireFigures(i = car.pIdx, c = 0) {
  const P = PRESSURES[i], n = car.wheels.length || 4, load = car.mass * G / n, R = car.R - P.defl;
  const SF = surfAtCell(cellIndex(car.pos.x, car.pos.z)), kEff = SF.k * (1 + SF.kComp * c);
  const pg = P.kpa * 1000 * 0.8 + 12000, b = P.w, len = Math.min(load / pg / b, 0.3), pEff = load / (b * Math.max(len, 0.05));
  const sink = SF.rigid ? 0 : Math.min(pEff / kEff, 0.28);
  const drag = SF.rc * b * kEff * sink * sink * 0.5 + 0.02 * load + load * 0.6 * (sink / R) ** 2;      // (rolling through it, per wheel)
  const grip = load * (SF.tanPhi + SF.tanPhiComp * c) + SF.coh * b * Math.max(len, 0.15);
  return { psi: P.psi, kpa: P.kpa, width: b, length: len, sink, drag: drag * n, grip: grip / load, radius: R, squash: P.defl, load, ground: SF.name, rigid: !!SF.rigid };
}
const SETUP = {
  get() {
    const zs = car.wheels.map(w => w.hp.z), zf = Math.max(...zs), zr = Math.min(...zs);
    let kw = 0; for (let r = ENG.idle; r <= ENG.limiter; r += 100) kw = Math.max(kw, engineTorque(r) * r * TAU / 60000);
    return { key: VEH.key, name: VEH.name, awd: car.awd, awdFixed: !!VEH.awdFixed, split: car.split, ownSplit: VEH.split ?? 0.5, ownAwd: !!VEH.awd,
      p: car.pIdx, ownP: VEH.pIdx, pressures: PRESSURES.map(P => ({ psi: P.psi, kpa: P.kpa })), frontWeight: zf > zr ? -zr / (zf - zr) : 0.5, power: kw, mass: car.mass };
  },
  split: setSplit, drive: setDrive, pressure: setPressure, figures: tireFigures,
};
car.pIdx = carPressure(VEH); car.awd = carDrive(VEH); car.split = carSplit(VEH);     // (the car the sim starts on)
""")
rep("""car.pIdx = V.pIdx; car.awd = V.awd; car.split = carSplit(V);""", """car.pIdx = carPressure(V); car.awd = carDrive(V); car.split = carSplit(V);""")

# ---- the read-out: the buggy's split too, when it drives all four unevenly
rep("""car.awd ? (VEH === BUGGY ? '4WD' : 'AWD' + (car.split !== 0.5 ? ` ${Math.round(car.split * 100)}/${Math.round((1 - car.split) * 100)}` : '')) : (VEH === BUGGY ? '2WD rear' : 'RWD')""",
    """car.awd ? (VEH === BUGGY ? '4WD' : 'AWD') + (car.split !== 0.5 ? ` ${Math.round(car.split * 100)}/${Math.round((1 - car.split) * 100)}` : '') : (VEH === BUGGY ? '2WD rear' : 'RWD')""")

# ---- each wheel's sideways force, beside its driving one (the drawer's picture of the grip each tire spends)
rep("""W.fx = Fx; W.fm = Fmax; W.td = Td;""", """W.fx = Fx; W.fy = Fy; W.fm = Fmax; W.td = Td;""")

# ---- the lab: another pressure, or the buggy's other drive, is another car to drive (the best is examined again)
rep("""    ...(car.awd && car.split !== 0.5 ? ['split' + car.split] : []),
""", """    ...(car.awd && car.split !== 0.5 ? ['split' + car.split] : []),
    ...(car.pIdx !== VEH.pIdx ? ['psi' + PRESSURES[car.pIdx].psi] : []), ...(car.awd !== !!VEH.awd ? ['awd' + +car.awd] : []),   // (#332)
""")

rep("""  Object.assign(window.__sim, { ai: AI, aiTrainSync, aiTry, aiDrive });
""", """  Object.assign(window.__sim, { ai: AI, aiTrainSync, aiTry, aiDrive });
  Object.assign(window.__sim, { setup: SETUP });                                  // (the Car setup drawer, ui.js)
""")

# ---- the keys' list: U opens the drawer (ui.js)
KEY = """<b>4</b> 2WD/4WD (AWD cars: front/rear split) &nbsp; """
rep(KEY, KEY + """<b>U</b> car setup (drive, tires) &nbsp; """)
open(ep, 'w', encoding='utf-8').write(s)

hp = os.path.join(sys.argv[1], 'index.html')
h = open(hp, encoding='utf-8').read()
assert h.count(KEY) == 1, h.count(KEY)
open(hp, 'w', encoding='utf-8').write(h.replace(KEY, KEY + """<b>U</b> car setup (drive, tires) &nbsp; """))
