/** Torque (N·m) at an rpm from a full-throttle curve [[rpm, N·m], ...], as the sim's engineTorque reads it. */
export function torqueAt(curve, rpm) {
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) if (rpm < curve[i][0]) return curve[i - 1][1] + (curve[i][1] - curve[i - 1][1]) * (rpm - curve[i - 1][0]) / (curve[i][0] - curve[i - 1][0]);
  return curve[curve.length - 1][1];
}
