// Settings sampler for the look copilot: pure functions, no I/O (sample.mjs is the CLI).
//
// Every sample is a complete 39-key patch (space.mjs KEYS), drawn from one of three strata:
//   exact   a built-in preset as shipped (keys it does not set at their defaults)
//   near    a built-in preset, perturbed: each key moves with some probability, in the
//           space its prior lives in (multiplicative for log-scale keys), switches flip rarely
//   broad   every key independently from its prior (space.mjs)
// then gating: a value whose switch is off is put back to its default.
//
// Sample i depends only on (seed, i) and the options, never on n or on the samples before it:
// asking for more samples later extends a set without changing its start.

import { KEYS, KEY_NAMES, PRESETS, PATTERN_SOURCES, PRESET_SOURCE } from './space.mjs';

/** mulberry32 (the same generator the app's offline mode seeds its chance with). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A generator for sample `index` of the set seeded `seed` (a 32-bit mix of the two). */
export function rngFor(seed, index) {
  let h = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 1, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return mulberry32((h ^ (h >>> 16)) >>> 0);
}

const uniform = (r, a, b) => a + (b - a) * r();
const logUniform = (r, a, b) => Math.exp(uniform(r, Math.log(a), Math.log(b)));
function gauss(r) { // Box-Muller, one value
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];
function weighted(r, values, w) {
  const total = w.reduce((s, x) => s + x, 0);
  let x = r() * total;
  for (let i = 0; i < values.length; i++) if ((x -= w[i]) < 0) return values[i];
  return values[values.length - 1];
}

function hslHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Snap to the slider step and keep inside the slider range. */
export function quantize(spec, x) {
  const decimals = Math.max(0, Math.ceil(-Math.log10(spec.step) - 1e-9));
  const q = Number((Math.round(x / spec.step) * spec.step).toFixed(decimals));
  return Math.min(spec.max, Math.max(spec.min, q));
}

/** One value from a key's prior. */
export function drawPrior(r, key) {
  const spec = KEYS[key];
  if ('fixed' in spec) return spec.fixed;
  const p = spec.prior;
  if (p.spike && r() < p.spike[0]) return p.spike[1];
  switch (p.kind) {
    case 'bool': return r() < p.p;
    case 'enum': return weighted(r, spec.values, p.w);
    case 'lin': return quantize(spec, uniform(r, p.a, p.b));
    case 'log': return quantize(spec, logUniform(r, p.a, p.b));
    case 'pow': return quantize(spec, p.a + (p.b - p.a) * r() ** p.k);
    case 'normal': return quantize(spec, p.mu + p.sigma * gauss(r));
    case 'decay': return quantize(spec, 1 - logUniform(r, 0.001, 0.5));
    case 'size': { // squash/stretch as a ratio; sometimes mirrored
      const m = logUniform(r, 0.25, 2);
      return quantize(spec, r() < 0.15 ? -m : m);
    }
    case 'rotation': {
      const u = r();
      if (u < 0.7) return 0;
      if (u < 0.8) return pick(r, [90, -90, 180]);
      return quantize(spec, uniform(r, -180, 180));
    }
    case 'tint': return hslHex(r(), uniform(r, 0.5, 1), uniform(r, 0.55, 0.8));
    case 'background': {
      const u = r();
      if (u < 0.15) return '#000000';
      return hslHex(r(), r(), u < 0.8 ? uniform(r, 0, 0.06) : uniform(r, 0.06, 0.35));
    }
    default: throw new Error(`no prior kind ${p.kind} (${key})`);
  }
}

/** Move one value a little, in the space its prior lives in. */
export function perturb(r, key, x) {
  const spec = KEYS[key];
  if ('fixed' in spec) return spec.fixed;
  const p = spec.prior;
  switch (spec.type) {
    case 'boolean': return r() < 0.1 ? !x : x;
    case 'enum': return r() < 0.1 ? drawPrior(r, key) : x;
    case 'color': return r() < 0.2 ? drawPrior(r, key) : x;
    default: break;
  }
  if (r() >= 0.35) return x; // most keys of a near-preset look stay put
  if (p.kind === 'log') return quantize(spec, Math.max(x, p.a) * Math.exp(0.3 * gauss(r)));
  if (p.kind === 'decay') return quantize(spec, 1 - Math.min(0.5, Math.max(0.001, 1 - x) * Math.exp(0.4 * gauss(r))));
  return quantize(spec, x + 0.08 * (spec.max - spec.min) * gauss(r));
}

/** True when every switch a key depends on is set as required. */
export function gateOpen(key, patch) {
  const g = KEYS[key].gate;
  return !g || Object.entries(g).every(([k, v]) => patch[k] === v);
}

/** Gated values whose switch is off go back to their default. */
export function applyGates(patch) {
  for (const key of KEY_NAMES) if (!gateOpen(key, patch)) patch[key] = KEYS[key].def;
  return patch;
}

const defaultsPatch = () => Object.fromEntries(KEY_NAMES.map((k) => [k, KEYS[k].def]));

export const PRESET_IDS = Object.keys(PRESETS);
export const PATTERN_IDS = Object.keys(PATTERN_SOURCES);

/**
 * Sample `index` of the set seeded `seed`.
 *   imageIds  ids of the source stills (may be empty: patterns only)
 *   pExact / pNear  stratum probabilities (the rest is broad)
 *   pImage    probability of an image source, when there are images
 * Returns { id, seed, source, stratum, preset, patch }; `seed` is the app's render seed.
 */
export function makeSample(seed, index, { imageIds = [], pExact = 0.05, pNear = 0.5, pImage = 0.5 } = {}) {
  const r = rngFor(seed, index);
  const renderSeed = Math.floor(r() * 2 ** 31);
  const u = r();
  const stratum = u < pExact ? 'exact' : u < pExact + pNear ? 'near' : 'broad';
  let preset = null;
  let patch;
  if (stratum === 'broad') {
    patch = Object.fromEntries(KEY_NAMES.map((k) => [k, drawPrior(r, k)]));
  } else {
    preset = pick(r, PRESET_IDS);
    patch = { ...defaultsPatch(), ...PRESETS[preset] };
    if (stratum === 'near') for (const k of KEY_NAMES) patch[k] = perturb(r, k, patch[k]);
  }
  applyGates(patch);
  let source;
  if (preset && PRESET_SOURCE[preset] && r() < 0.6) source = PRESET_SOURCE[preset];
  else if (imageIds.length && r() < pImage) source = pick(r, imageIds);
  else source = pick(r, PATTERN_IDS);
  return { id: String(index).padStart(6, '0'), seed: renderSeed, source, stratum, preset, patch };
}

/** Every way a patch can be unloadable or out of range; [] when it is fine. */
export function validatePatch(patch) {
  const errors = [];
  for (const k of Object.keys(patch)) if (!(k in KEYS)) errors.push(`${k}: not a first-set key`);
  for (const k of KEY_NAMES) {
    const spec = KEYS[k];
    const v = patch[k];
    if (!(k in patch)) { errors.push(`${k}: missing`); continue; }
    if ('fixed' in spec && v !== spec.fixed) errors.push(`${k}: must be ${spec.fixed}`);
    if (spec.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) errors.push(`${k}: not a finite number (${v})`);
      else if (v < spec.min || v > spec.max) errors.push(`${k}: ${v} outside ${spec.min}..${spec.max}`);
    } else if (spec.type === 'boolean') {
      if (typeof v !== 'boolean') errors.push(`${k}: not a boolean`);
    } else if (spec.type === 'enum') {
      if (!spec.values.includes(v)) errors.push(`${k}: ${v} not one of ${spec.values.join('/')}`);
    } else if (spec.type === 'color') {
      if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/.test(v)) errors.push(`${k}: ${v} is not #rrggbb`);
    }
    if (!gateOpen(k, patch) && v !== spec.def) errors.push(`${k}: gate closed but value ${v} is not the default`);
  }
  return errors;
}
