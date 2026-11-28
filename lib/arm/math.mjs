// The arm sim's own sin, cos, tanh, atan2, acos, log and hypot (#359). JavaScript leaves Math.sin and the like to each engine
// ("an implementation-approximated value"), and they do differ in the last digit: Chrome 159 and Node 24 gave one stack
// network 78.017 s and 78.067 s for the same exam. These are built from + − × ÷ and Math.sqrt alone, which IEEE 754 rounds
// one way everywhere, so a drive is the same in any browser and on a server.
// They are fdlibm's (FreeBSD's msun, as V8 carried it in src/base/ieee754.cc; hypot is V8's Math.hypot), written to give what
// Node 24 gives bit for bit, so the exams measured before them stand: test/arm.test.mjs compares them with Node's and with a
// pinned hash. Don't "simplify" an expression here: a different order of the same sum is a different last digit.
// Copyright (C) 1993-2004 by Sun Microsystems, Inc. All rights reserved. Permission to use, copy, modify, and distribute
// this software is freely granted, provided that this notice is preserved.

const F = new Float64Array(1), U = new Int32Array(F.buffer);
const HI = (() => { F[0] = 1; return U[1] ? 1 : 0; })(), LO = 1 - HI;        // which half holds the sign and exponent on this machine
const hiOf = x => { F[0] = x; return U[HI]; };
const withHi = (x, hi) => { F[0] = x; U[HI] = hi; return F[0]; };
const words = (hi, lo) => { U[HI] = hi; U[LO] = lo; return F[0]; };

// sin and cos on [-π/4, π/4], x + y the argument (y its tail)
const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04, S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
function ksin(x, y, iy) {
  if ((hiOf(x) & 0x7fffffff) < 0x3e400000) return x;                         // |x| < 2^-27
  const z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return iy === 0 ? x + v * (S1 + z * r) : x - ((z * (0.5 * y - v * r) - y) - v * S1);
}
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05, C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
function kcos(x, y) {
  const ix = hiOf(x) & 0x7fffffff;
  if (ix < 0x3e400000) return 1;
  const z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));              // |x| < 0.3
  const qx = ix > 0x3fe90000 ? 0.28125 : words(ix - 0x00200000, 0), hz = 0.5 * z - qx, a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

// x = n·π/2 + (Y0 + Y1), |Y0 + Y1| ≤ π/4; gives n. π/2 is taken away in three pieces of 33 bits, as many as the cancellation needs.
const INVPIO2 = 6.36619772367581382433e-01, PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11, PIO2_2 = 6.07710050630396597660e-11, PIO2_2T = 2.02226624879595063154e-21, PIO2_3 = 2.02226624871116645580e-21, PIO2_3T = 8.47842766036889956997e-32;
const NPIO2_HW = [0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB,
  0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB];
const TWO_PI = 6.283185307179586;
let Y0 = 0, Y1 = 0;
function remPio2(x) {
  let hx = hiOf(x), ix = hx & 0x7fffffff;
  // Beyond 2^19·π/2 (about 820 000 radians: no joint, no angle in the sim comes near) fdlibm multiplies by 1200 bits of 2/π.
  // Here the turns are taken off with one remainder instead: the same on every engine, but of a 2π that is itself rounded,
  // so less exact the larger x is (9 digits right at 10 million radians, none at 10^16). Not Node's there.
  if (ix > 0x413921fb) { x = x % TWO_PI; hx = hiOf(x); ix = hx & 0x7fffffff; }
  if (ix <= 0x3fe921fb) { Y0 = x; Y1 = 0; return 0; }
  if (ix < 0x4002d97c) {                                                     // |x| < 3π/4: n = ±1
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) { Y0 = z - PIO2_1T; Y1 = (z - Y0) - PIO2_1T; } else { z -= PIO2_2; Y0 = z - PIO2_2T; Y1 = (z - Y0) - PIO2_2T; }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) { Y0 = z + PIO2_1T; Y1 = (z - Y0) + PIO2_1T; } else { z += PIO2_2; Y0 = z + PIO2_2T; Y1 = (z - Y0) + PIO2_2T; }
    return -1;
  }
  let t = Math.abs(x); const n = (t * INVPIO2 + 0.5) | 0, fn = n;
  let r = t - fn * PIO2_1, w = fn * PIO2_1T;
  if (n < 32 && ix !== NPIO2_HW[n - 1]) Y0 = r - w;
  else {
    const j = ix >> 20; Y0 = r - w;
    if (j - ((hiOf(Y0) >> 20) & 0x7ff) > 16) {                               // a second piece
      t = r; w = fn * PIO2_2; r = t - w; w = fn * PIO2_2T - ((t - r) - w); Y0 = r - w;
      if (j - ((hiOf(Y0) >> 20) & 0x7ff) > 49) { t = r; w = fn * PIO2_3; r = t - w; w = fn * PIO2_3T - ((t - r) - w); Y0 = r - w; }   // a third: 151 bits
    }
  }
  Y1 = (r - Y0) - w;
  if (hx < 0) { Y0 = -Y0; Y1 = -Y1; return -n; }
  return n;
}

export function sin(x) {
  x = +x; const ix = hiOf(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return ksin(x, 0, 0);
  if (ix >= 0x7ff00000) return NaN;
  switch (remPio2(x) & 3) { case 0: return ksin(Y0, Y1, 1); case 1: return kcos(Y0, Y1); case 2: return -ksin(Y0, Y1, 1); default: return -kcos(Y0, Y1); }
}
export function cos(x) {
  x = +x; const ix = hiOf(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kcos(x, 0);
  if (ix >= 0x7ff00000) return NaN;
  switch (remPio2(x) & 3) { case 0: return kcos(Y0, Y1); case 1: return -ksin(Y0, Y1, 1); case 2: return -kcos(Y0, Y1); default: return ksin(Y0, Y1, 1); }
}

// e^x − 1 for |x| < 56·ln 2: all tanh asks of it
const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INVLN2 = 1.44269504088896338700e+00;
const Q1 = -3.33333333333331316428e-02, Q2 = 1.58730158725481460165e-03, Q3 = -7.93650757867487942473e-05, Q4 = 4.00821782732936239552e-06, Q5 = -2.01099218183624371326e-07;
function expm1(x) {
  let hx = hiOf(x); const neg = hx < 0; hx &= 0x7fffffff;
  if (hx >= 0x4043687a) return neg ? -1 : Infinity;                          // not reached from tanh (|x| < 44)
  let k = 0, c = 0;
  if (hx > 0x3fd62e42) {                                                     // |x| > ½ ln 2: x = k·ln 2 + r
    let hi, lo;
    if (hx < 0x3ff0a2b2) { if (!neg) { hi = x - LN2_HI; lo = LN2_LO; k = 1; } else { hi = x + LN2_HI; lo = -LN2_LO; k = -1; } }
    else { k = (INVLN2 * x + (neg ? -0.5 : 0.5)) | 0; const t = k; hi = x - t * LN2_HI; lo = t * LN2_LO; }
    x = hi - lo; c = (hi - x) - lo;
  } else if (hx < 0x3c900000) return x;                                      // |x| < 2^-54
  const hfx = 0.5 * x, hxs = x * hfx, r1 = 1 + hxs * (Q1 + hxs * (Q2 + hxs * (Q3 + hxs * (Q4 + hxs * Q5))));
  let t = 3 - r1 * hfx, e = hxs * ((r1 - t) / (6 - x * t));
  if (k === 0) return x - (x * e - hxs);
  const twopk = words(0x3ff00000 + (k << 20), 0);
  e = (x * (e - c) - c); e -= hxs;
  if (k === -1) return 0.5 * (x - e) - 0.5;
  if (k === 1) return x < -0.25 ? -2 * (e - (x + 0.5)) : 1 + 2 * (x - e);
  if (k <= -2 || k > 56) return (1 - (e - x)) * twopk - 1;
  if (k < 20) { t = withHi(1, 0x3ff00000 - (0x200000 >> k)); return (t - (e - x)) * twopk; }   // t = 1 − 2^-k
  t = words((0x3ff - k) << 20, 0);                                           // 2^-k
  return ((x - (e + t)) + 1) * twopk;
}
export function tanh(x) {
  x = +x; const jx = hiOf(x), ix = jx & 0x7fffffff;
  if (ix >= 0x7ff00000) return x !== x ? NaN : jx >= 0 ? 1 : -1;
  let z;
  if (ix < 0x40360000) {                                                     // |x| < 22
    if (ix < 0x3e300000) return x;                                           // |x| < 2^-28
    if (ix >= 0x3ff00000) { const t = expm1(2 * Math.abs(x)); z = 1 - 2 / (t + 2); }
    else { const t = expm1(-2 * Math.abs(x)); z = -t / (t + 2); }
  } else z = 1;
  return jx >= 0 ? z : -z;
}

const PIO2_HI = 1.57079632679489655800e+00, PIO2_LO = 6.12323399573676603587e-17, PI = 3.14159265358979311600e+00;
const pS0 = 1.66666666666666657415e-01, pS1 = -3.25565818622400915405e-01, pS2 = 2.01212532134862925881e-01, pS3 = -4.00555345006794114027e-02, pS4 = 7.91534994289814532176e-04, pS5 = 3.47933107596021167570e-05;
const qS1 = -2.40339491173441421878e+00, qS2 = 2.02094576023350569471e+00, qS3 = -6.88283971605453293030e-01, qS4 = 7.70381505559019352791e-02;
export function acos(x) {
  x = +x; const hx = hiOf(x), ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) return x === 1 ? 0 : x === -1 ? PI + 2 * PIO2_LO : NaN;
  if (ix < 0x3fe00000) {                                                     // |x| < 0.5
    if (ix <= 0x3c600000) return PIO2_HI + PIO2_LO;
    const z = x * x, p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5))))), q = 1 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4))), r = p / q;
    return PIO2_HI - (x - (PIO2_LO - x * r));
  }
  if (hx < 0) {                                                              // x < -0.5
    const z = (1 + x) * 0.5, p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5))))), q = 1 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4)));
    const s = Math.sqrt(z), r = p / q, w = r * s - PIO2_LO;
    return PI - 2 * (s + w);
  }
  const z = (1 - x) * 0.5, s = Math.sqrt(z); F[0] = s; U[LO] = 0; const df = F[0], c = (z - df * df) / (s + df);
  const p = z * (pS0 + z * (pS1 + z * (pS2 + z * (pS3 + z * (pS4 + z * pS5))))), q = 1 + z * (qS1 + z * (qS2 + z * (qS3 + z * qS4))), r = p / q, w = r * s + c;
  return 2 * (df + w);
}

const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const aT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01, 9.09088713343650656196e-02, -7.69187620504482999495e-02,
  6.66107313738753120669e-02, -5.83357013379057348645e-02, 4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
function atan(x) {
  const hx = hiOf(x), ix = hx & 0x7fffffff; let id;
  if (ix >= 0x44100000) return x !== x ? NaN : hx > 0 ? ATANHI[3] + ATANLO[3] : -ATANHI[3] - ATANLO[3];     // |x| ≥ 2^66
  if (ix < 0x3fdc0000) { if (ix < 0x3e200000) return x; id = -1; }           // |x| < 7/16
  else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) { if (ix < 0x3fe60000) { id = 0; x = (2 * x - 1) / (2 + x); } else { id = 1; x = (x - 1) / (x + 1); } }
    else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); }
    else { id = 3; x = -1 / x; }
  }
  const z = x * x, w = z * z;
  const s1 = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10]))))), s2 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATANHI[id] - ((x * (s1 + s2) - ATANLO[id]) - x);
  return hx < 0 ? -r : r;
}
const PI_LO = 1.2246467991473531772e-16;
export function atan2(y, x) {
  y = +y; x = +x;
  if (x !== x || y !== y) return NaN;
  if (x === 1) return atan(y);
  F[0] = x; const hx = U[HI], ix = hx & 0x7fffffff; F[0] = y; const hy = U[HI], iy = hy & 0x7fffffff;
  let m = ((hy >> 31) & 1) | ((hx >> 30) & 2);                               // 2·(x < 0) + (y < 0)
  if (y === 0) return m < 2 ? y : m === 2 ? PI : -PI;
  if (x === 0) return hy < 0 ? -PIO2_HI : PIO2_HI;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) return m === 0 ? PI / 4 : m === 1 ? -PI / 4 : m === 2 ? 3 * (PI / 4) : -3 * (PI / 4);
    return m === 0 ? 0 : m === 1 ? -0 : m === 2 ? PI : -PI;
  }
  if (iy === 0x7ff00000) return hy < 0 ? -PIO2_HI : PIO2_HI;
  const k = (iy - ix) >> 20; let z;
  if (k > 60) { z = PIO2_HI + 0.5 * PI_LO; m &= 1; }                         // |y/x| > 2^60
  else if (hx < 0 && k < -60) z = 0;
  else z = atan(Math.abs(y / x));
  return m === 0 ? z : m === 1 ? -z : m === 2 ? PI - (z - PI_LO) : (z - PI_LO) - PI;
}

const TWO54 = 1.80143985094819840000e+16, Lg1 = 6.666666666666735130e-01, Lg2 = 3.999999999940941908e-01, Lg3 = 2.857142874366239149e-01, Lg4 = 2.222219843214978396e-01, Lg5 = 1.818357216161805012e-01, Lg6 = 1.531383769920937332e-01, Lg7 = 1.479819860511658591e-01;
export function log(x) {
  x = +x;
  if (x !== x || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return x;
  let hx = hiOf(x), k = 0;
  if (hx < 0x00100000) { k -= 54; x *= TWO54; hx = hiOf(x); }                // below 2^-1022
  k += (hx >> 20) - 1023; hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = withHi(x, hx | (i ^ 0x3ff00000));                                      // x or x/2, in [√½, √2)
  k += i >> 20;
  const f = x - 1, dk = k;
  if ((0x000fffff & (2 + hx)) < 3) {                                         // |f| < 2^-20
    if (f === 0) return k === 0 ? 0 : dk * LN2_HI + dk * LN2_LO;
    const R = f * f * (0.5 - 0.33333333333333333 * f);
    return k === 0 ? f - R : dk * LN2_HI - ((R - dk * LN2_LO) - f);
  }
  const s = f / (2 + f), z = s * s, w = z * z;
  i = hx - 0x6147a; const j = 0x6b851 - hx;
  const t1 = w * (Lg2 + w * (Lg4 + w * Lg6)), t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7))), R = t2 + t1;
  if ((i | j) > 0) { const hfsq = 0.5 * f * f; return k === 0 ? f - (hfsq - s * (hfsq + R)) : dk * LN2_HI - ((hfsq - (s * (hfsq + R) + dk * LN2_LO)) - f); }
  return k === 0 ? f - s * (f - R) : dk * LN2_HI - ((s * (f - R) - dk * LN2_LO) - f);
}

/** √(a² + b² + c²): each over the largest, the squares summed with Kahan's correction (V8's Math.hypot) */
export function hypot(a, b, c = 0) {
  a = Math.abs(+a); b = Math.abs(+b); c = Math.abs(+c);
  const nan = a !== a || b !== b || c !== c;
  let max = 0; if (a > max) max = a; if (b > max) max = b; if (c > max) max = c;
  if (max === Infinity) return Infinity;
  if (nan) return NaN;
  if (max === 0) return 0;
  let sum = 0, comp = 0, n, summand, pre;
  n = a / max; summand = n * n - comp; pre = sum + summand; comp = (pre - sum) - summand; sum = pre;
  n = b / max; summand = n * n - comp; pre = sum + summand; comp = (pre - sum) - summand; sum = pre;
  if (arguments.length > 2) { n = c / max; summand = n * n - comp; pre = sum + summand; comp = (pre - sum) - summand; sum = pre; }
  return Math.sqrt(sum) * max;
}

/** b to the power of a whole k ≥ 0, by k multiplications (Math.pow is the engine's too) */
export function ipow(b, k) { let p = 1; for (let i = 0; i < k; i++) p *= b; return p; }
