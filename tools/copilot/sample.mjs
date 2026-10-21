#!/usr/bin/env node
// Write N settings samples for the look copilot (sampler.mjs) as JSONL, plus the sources
// they name.
//
//   node tools/copilot/sample.mjs --n 5000 --seed 1 --out samples.jsonl [--images a.png,b.jpg]
//        [--p-exact 0.05] [--p-near 0.5] [--p-image 0.5]
//
// Output:
//   <out>                 one {id, seed, source, stratum, preset, patch} per line
//   <out>.sources.json    {set, seed, n, sources: {<id>: {settings, image?, sha256?}}}
//                         every source a sample names, with the settings it loads; an image
//                         is recorded by path AND sha256 (stills.mjs refuses a changed file).
// Prints how the set came out (strata, sources, gate rates).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { makeSample, validatePatch } from './sampler.mjs';
import { PATTERN_SOURCES, IMAGE_SOURCE_SETTINGS } from './space.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const n = Number(opt('n', 1000));
const seed = Number(opt('seed', 1));
const out = opt('out');
if (!out || !(n > 0) || !Number.isInteger(seed)) {
  console.error('usage: sample.mjs --n <count> --seed <int> --out <samples.jsonl> [--images a.png,b.jpg]');
  process.exit(2);
}

const sources = {};
for (const [id, settings] of Object.entries(PATTERN_SOURCES)) sources[id] = { settings };
const imageIds = [];
for (const p of (opt('images', '') || '').split(',').filter(Boolean)) {
  const path = resolve(p);
  if (!existsSync(path)) throw new Error(`no such image: ${path}`);
  if (!/^\.(png|jpe?g)$/i.test(extname(path))) throw new Error(`not a PNG/JPG: ${path}`);
  const id = `image:${basename(path, extname(path))}`;
  if (sources[id]) throw new Error(`two images named ${id}: rename one`);
  sources[id] = { settings: IMAGE_SOURCE_SETTINGS, image: path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
  imageIds.push(id);
}
const opts = { imageIds, pExact: Number(opt('p-exact', 0.05)), pNear: Number(opt('p-near', 0.5)), pImage: Number(opt('p-image', 0.5)) };

const lines = [];
const count = (m, k) => { m[k] = (m[k] ?? 0) + 1; };
const strata = {}, bySource = {}, gates = {};
for (let i = 0; i < n; i++) {
  const s = makeSample(seed, i, opts);
  const errors = validatePatch(s.patch);
  if (errors.length) throw new Error(`sample ${s.id}: ${errors.join('; ')}`); // a sampler bug: never write it
  lines.push(JSON.stringify(s));
  count(strata, s.stratum);
  count(bySource, s.source);
  for (const g of ['bloomEnabled', 'scanlineEnabled', 'vignetteEnabled', 'feedbackEnabled', 'analogEnabled', 'zInvert']) if (s.patch[g]) count(gates, g);
  if (s.patch.renderMode === 'wireframe') count(gates, 'wireframe');
  if (s.patch.colorMode === 'phosphorCustom') count(gates, 'phosphorCustom');
}
writeFileSync(resolve(out), lines.join('\n') + '\n');
writeFileSync(`${resolve(out)}.sources.json`, JSON.stringify({ seed, n, options: opts, sources }, null, 1));
const pct = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, `${((100 * v) / n).toFixed(1)}%`]));
console.log(JSON.stringify({ wrote: resolve(out), n, seed, strata: pct(strata), sources: pct(bySource), on: pct(gates) }, null, 1));
