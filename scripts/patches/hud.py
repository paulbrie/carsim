# The read-out, as small as it goes (#350): the dial has the speed, the revs and the gear, so they leave the panel
# in the corner, and the table of the four wheels becomes a picture:
#   - the four tires seen from above (front up): each fills with its slip (red once it spins or locks), a mark on its
#     outer side for how deep it sinks, a dashed outline while it is in the air;
#   - two lines beside them: the car as set (its name, the drive, the pressure, the aids), then the largest slip, the
#     deepest sinking (only on ground a tire sinks into) and the frames a second;
#   - built once and then only updated (it was written whole ten times a second); its look is in public/sim/ui.css.
# Applies to public/sim/engine.js after the other patches (last in the chain):
#   python3 scripts/patches/hud.py <dir with engine.js>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep, encoding='utf-8').read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

rep("""  const kmh = Math.abs(car.vel.dot(fwd)) * 3.6, P = PRESSURES[car.pIdx];
  const rows = car.wheels.map(w => {
    const sink = w.contact ? w.sink * 100 : 0, slip = w.contact ? Math.min(Math.abs(w.slip), 1) * 100 : 0;
    return `<tr><td>${w.name}</td><td>${sink.toFixed(1).padStart(4)} cm</td><td><span class="bar" style="width:${clamp(sink * 2, 0, 60)}px"></span></td>
      <td>${slip.toFixed(0).padStart(3)}%</td><td><span class="bar slip" style="width:${slip * 0.6}px"></span></td></tr>`;
  }).join('');
  const E = car.eng, rpmPct = clamp(E.rpm / ENG.limiter, 0, 1) * 100;
  hud.innerHTML = `<div class="big">${kmh.toFixed(0)} <span style="font-size:15px">km/h</span> <span style="font-size:20px;margin-left:10px">${E.reverse ? 'R' : E.gear}</span></div>
    <div style="margin:2px 0 4px"><span class="bar" style="width:${rpmPct * 1.9}px;background:${rpmPct > 90 ? '#ff5a3c' : '#ffcf6b'}"></span> ${(E.rpm / 1000).toFixed(1)}k rpm</div>
    ${VEH.short} · """, """  // (#350) the dial has the speed, the revs and the gear: here the four tires from above (each fills with its slip, the
  // mark beside it is how deep it sinks) and two lines, built once and then only updated
  if (!HUD.w || HUD.w.length !== car.wheels.length) hudBuild();
  const P = PRESSURES[car.pIdx];
  let slipMax = 0, sinkMax = 0, soft = false, touch = false;
  car.wheels.forEach((w, i) => {
    const slip = w.contact ? Math.min(Math.abs(w.slip), 1) : 0, sink = w.contact && !w.deck && !w.surf?.rigid ? w.sink * 100 : 0, e = HUD.w[i];
    if (w.contact) { touch = true; if (!w.deck && !w.surf?.rigid) soft = true; }
    slipMax = Math.max(slipMax, slip); sinkMax = Math.max(sinkMax, sink);
    const cls = !w.contact ? 'air' : slip >= 0.5 ? 'hot' : ''; if (e.cls !== cls) e.el.className = e.cls = cls;
    // (the square root: a slip of a few per cent, where the grip is, already shows; under 1 %, or 1 mm, nothing)
    const hs = slip < 0.01 ? 0 : Math.round(Math.sqrt(slip) * 100), hk = sink < 0.1 ? 0 : Math.round(Math.sqrt(Math.min(sink / 20, 1)) * 100);
    if (e.hs !== hs) e.slip.style.height = (e.hs = hs) + '%';
    if (e.hk !== hk) e.sink.style.height = (e.hk = hk) + '%';
  });
  if (touch) HUD.soft = soft; else soft = HUD.soft;                    // (in the air: as where it last stood)
  const a = `<b>${VEH.short}</b> · """)
rep("""'2WD rear' : 'RWD')} · tires ${P.psi} psi${VEH.aids ? ` · TC/ABS ${car.aids ? 'on' : 'off'}` : ''} · ${fps.toFixed(0)} fps
    <table><tr><td></td><td>sinkage</td><td></td><td>slip</td><td></td></tr>${rows}</table>`;
}
""", """'2WD rear' : 'RWD')} · ${P.psi} psi${VEH.aids ? car.aids ? ' · TC/ABS' : ' · <span class="off">TC/ABS off</span>' : ''}`;
  const b = `<span class="s">slip</span> ${String(Math.round(slipMax * 100)).padStart(2)}%${soft ? ` · <span class="k">sinks</span> ${sinkMax.toFixed(1)} cm` : ''} · ${fps.toFixed(0)} fps`;
  if (a !== HUD.sa) HUD.a.innerHTML = HUD.sa = a;
  if (b !== HUD.sb) HUD.b.innerHTML = HUD.sb = b;
}
""")
rep("""function updateHud(dt) {
""", """const HUD = { w: null, a: null, b: null, sa: '', sb: '', soft: false };
function hudBuild() {
  hud.innerHTML = `<div class="hw">${car.wheels.map(() => '<i><b></b><u></u></i>').join('')}</div><div class="ht"><div></div><div></div></div>`;
  HUD.w = [...hud.querySelectorAll('.hw i')].map(el => ({ el, slip: el.firstChild, sink: el.lastChild, cls: '', hs: -1, hk: -1 }));
  [HUD.a, HUD.b] = hud.querySelectorAll('.ht div'); HUD.sa = HUD.sb = '';
}
function updateHud(dt) {
""")
open(ep, 'w', encoding='utf-8').write(s)
