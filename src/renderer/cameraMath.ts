/**
 * Pure maths for the Virtual Camera transform (Settings camPosX..camRotZ). No three.js, so the
 * settings migration and the tests can use it.
 *
 * Rotation is Euler degrees in Unity's order (Y yaw, then X pitch, then Z roll — three.js 'YXZ'),
 * in three.js's sign convention: the camera looks down −Z, +X pitch tilts the view up, +Y yaw turns
 * it left, +Z roll turns it counter-clockwise.
 */

export type Vec3 = readonly [number, number, number];

const DEG = 180 / Math.PI;

/** Wrap degrees into (−180, 180]. */
export function normalizeDeg(a: number): number {
  let r = ((a + 180) % 360 + 360) % 360 - 180;
  if (r === -180) r = 180;
  return r;
}

/** `a` plus whole turns, as close as possible to `ref`. */
export function unwrapNear(a: number, ref: number): number {
  return a + 360 * Math.round((ref - a) / 360);
}

/**
 * Euler (YXZ, degrees) for a camera at `eye` looking at `target` with `up` — the same basis as
 * three's `Matrix4.lookAt` for a camera (z = eye − target, x = up × z, y = z × x), read out with
 * three's YXZ extraction.
 */
export function lookAtEuler(eye: Vec3, target: Vec3, up: Vec3): [number, number, number] {
  let z = sub(eye, target);
  if (len(z) === 0) z = [0, 0, 1];
  z = norm(z);
  let x = cross(up, z);
  if (len(x) === 0) {
    // Looking straight along `up`: nudge like three does.
    z = norm([z[0] + 1e-4, z[1], z[2] + (Math.abs(up[2]) === 1 ? 0 : 1e-4)]);
    x = cross(up, z);
  }
  x = norm(x);
  const y = cross(z, x);
  // Rotation matrix columns are x, y, z. m23 = z.y, m13 = z.x, m33 = z.z, m21 = x.y, m22 = y.y.
  const m23 = z[1];
  const rx = Math.asin(-clamp(m23, -1, 1));
  let ry: number, rz: number;
  if (Math.abs(m23) < 0.9999999) {
    ry = Math.atan2(z[0], z[2]);
    rz = Math.atan2(x[1], y[1]);
  } else {
    ry = Math.atan2(-x[2], x[0]);
    rz = 0;
  }
  return [rx * DEG, ry * DEG, rz * DEG];
}

/**
 * The YXZ angles `cand` describe the same orientation as (180 − x, y + 180, z + 180). Pick the
 * form, and the whole turns on each axis, that lands closest to `ref` — so a camera tumbling over
 * the top keeps counting smoothly instead of flipping yaw and roll by 180°.
 */
export function continuousEuler(cand: Vec3, ref: Vec3): [number, number, number] {
  const forms: Vec3[] = [cand, [180 - cand[0], cand[1] + 180, cand[2] + 180]];
  let best: [number, number, number] = [cand[0], cand[1], cand[2]];
  let bestD = Infinity;
  for (const f of forms) {
    const u: [number, number, number] = [unwrapNear(f[0], ref[0]), unwrapNear(f[1], ref[1]), unwrapNear(f[2], ref[2])];
    const d = Math.abs(u[0] - ref[0]) + Math.abs(u[1] - ref[1]) + Math.abs(u[2] - ref[2]);
    if (d < bestD - 1e-9) { bestD = d; best = u; }
  }
  return best;
}

function sub(a: Vec3, b: Vec3): [number, number, number] { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function len(a: Vec3): number { return Math.hypot(a[0], a[1], a[2]); }
function norm(a: Vec3): [number, number, number] { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
