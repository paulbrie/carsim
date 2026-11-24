# The wheels' spin, solved implicitly (#327). The tire's force rises with slip up to its grip and then levels off; the
# original update linearised it at the step's start, which is right near zero slip but, at walking pace (the slip measured
# against 1.5 m/s), let a wheel that had slipped far jump across to as much slip the other way, 240 times a second: a
# coasting car's wheels swung between -85 % and +35 % slip (±6 kN each) instead of rolling. Each step now finds the spin
# at which the wheel's torques balance at the step's end (backward Euler: Newton's method, kept inside a bracket).
# Applies to public/sim/engine.js after the rest of the chain (before ui.py):
#   python3 scripts/patches/tires.py <dir with engine.js>
import sys, os
ep = os.path.join(sys.argv[1], 'engine.js')
s = open(ep).read()

def rep(a, b):
    global s
    n = s.count(a)
    assert n == 1, (n, a[:140])
    s = s.replace(a, b)

rep("""    const dF = Fmax / S0 * Math.exp(-Math.abs(s) / S0) * R / den;
    W.omega = (car.Iw * W.omega + dt * (Td - R * Fx + R * dF * W.omega)) / (car.Iw + dt * R * dF);
""", """    W.omega = wheelSpin(W.omega, Td, vLong, R, Fmax, S0, dt);
""")

rep("""function applyBrake(W, Tb, dt) {""", """// The wheel's spin at the end of a step (#327): w where Iw (w - w0) = dt (Td - R Fx(w)), Fx the tire's force at that spin.
// Iw w + dt R Fx(w) only grows with w, and Fx stays within ±Fmax, so the answer lies in [lo, hi] below: Newton's
// method from the start's spin, bisecting whenever a step would leave what is left of that bracket.
function wheelSpin(w0, Td, vLong, R, Fmax, S0, dt) {
  const I = car.Iw;
  let lo = w0 + dt * (Td - R * Fmax) / I, hi = w0 + dt * (Td + R * Fmax) / I, w = clamp(w0, lo, hi);
  for (let it = 0; it < 12; it++) {
    const den = Math.max(Math.abs(w * R), Math.abs(vLong), 1.5), s = (w * R - vLong) / den, e = Math.exp(-Math.abs(s) / S0);
    const g = I * (w - w0) - dt * (Td - R * Math.sign(s) * Fmax * (1 - e));
    if (Math.abs(g) < 1e-6 * I) break;
    if (g > 0) hi = w; else lo = w;
    let n = w - g / (I + dt * R * Fmax / S0 * e * R / den);       // (the slope as if den held: exact below the 1.5 m/s floor)
    if (!(n > lo && n < hi)) n = 0.5 * (lo + hi);
    if (Math.abs(n - w) < 1e-7) { w = n; break; }
    w = n;
  }
  return w;
}
function applyBrake(W, Tb, dt) {""")

open(ep, 'w').write(s)
print('tires: the wheel spin solved implicitly')
