#!/usr/bin/env node
// Render one still per sample (sample.mjs) through the BUILT app in offline mode.
//
//   node tools/copilot/stills.mjs --samples samples.jsonl --out <dir>
//        [--sources samples.jsonl.sources.json] [--size 768 | --width W --height H]
//        [--frames 45] [--fps 30] [--profile quality] [--limit N]
//
// One headed Chrome (tools/offline-render/browser.mjs: real GPU or nothing, ANGLE on OpenGL)
// loads the app once; then for each sample `window.__ruttOffline.still(...)`:
//   reset every key an earlier still touched to its default (and the camera pose),
//   apply source settings + the 39-key patch the way a built-in preset loads,
//   bind the source image (if the source is one), reseed chance, zero the post-FX clock,
//   step --frames frames at --fps (t = 0 .. (frames-1)/fps), capture.
// Writes <out>/<id>.png and appends {id, sha256, ms, mean, max} to <out>/manifest.jsonl
// (sha256 of the raw RGBA pixels; mean/max luminance 0..1 to spot blank looks).
// Resume: ids already in the manifest are skipped. Each run appends its conditions (GPU,
// profile, size, frames, app commit) to <out>/runs.jsonl.
//
// The performance profile is pinned (default 'quality'): left alone, a 768 px window gets
// 'balanced', which turns chroma off and renders bloom at half size.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openOfflinePage, fulfillFile } from '../offline-render/browser.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const samplesPath = opt('samples') && resolve(opt('samples'));
const outDir = opt('out') && resolve(opt('out'));
if (!samplesPath || !outDir) {
  console.error('usage: stills.mjs --samples <samples.jsonl> --out <dir> [--size 768] [--frames 45] [--fps 30] [--profile quality] [--limit N]');
  process.exit(2);
}
const sourcesPath = resolve(opt('sources', `${samplesPath}.sources.json`));
const size = Number(opt('size', 768));
const width = Number(opt('width', size)), height = Number(opt('height', size));
const frames = Number(opt('frames', 45));
const fps = Number(opt('fps', 30));
const profile = opt('profile', 'quality');
const limit = Number(opt('limit', Infinity));
if (!['quality', 'balanced', 'battery'].includes(profile)) throw new Error(`--profile ${profile}: quality|balanced|battery`);
if (!(frames >= 1 && fps > 0 && width > 0 && height > 0)) throw new Error('frames, fps, width, height must be positive');

const samples = readFileSync(samplesPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const { sources } = JSON.parse(readFileSync(sourcesPath, 'utf8'));

// Sources: an image is served at /__src/<n><ext> and must still be the file the set was made from.
const imageUrl = {};
const imageFile = {};
Object.entries(sources).forEach(([id, s], n) => {
  if (!s.image) return;
  if (!existsSync(s.image)) throw new Error(`source ${id}: ${s.image} is missing`);
  const sha = createHash('sha256').update(readFileSync(s.image)).digest('hex');
  if (sha !== s.sha256) throw new Error(`source ${id}: ${s.image} changed since the samples were made (sha256 ${sha.slice(0, 12)} != ${s.sha256.slice(0, 12)})`);
  const url = `/__src/${n}${extname(s.image).toLowerCase()}`;
  imageUrl[id] = url;
  imageFile[url] = s.image;
});
for (const s of samples) if (!sources[s.source]) throw new Error(`sample ${s.id}: unknown source ${s.source}`);

mkdirSync(outDir, { recursive: true });
const manifestPath = join(outDir, 'manifest.jsonl');
const done = new Set(existsSync(manifestPath)
  ? readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
const todo = samples.filter((s) => !done.has(s.id)).slice(0, limit);
console.log(`${samples.length} samples, ${done.size} already rendered, ${todo.length} to do -> ${outDir}`);
if (!todo.length) process.exit(0);

const pageJob = { stills: true, width, height, fps, profile, seed: 1 };
const serve = (route, url) => {
  if (url.pathname === '/__stills/job.json') return route.fulfill({ body: JSON.stringify(pageJob), contentType: 'application/json' });
  if (url.pathname.startsWith('/__src/')) return fulfillFile(route, imageFile[url.pathname]);
  return undefined;
};

function appCommit() {
  try {
    const repo = resolve(HERE, '../..');
    const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', repo, 'status', '--porcelain', '--', 'src'], { encoding: 'utf8' }).trim() !== '';
    return dirty ? `${head}+dirty-src` : head;
  } catch { return 'unknown'; }
}

const { browser, page, info, errors } = await openOfflinePage({ width, height, jobUrl: '/__stills/job.json', serve });
if (info.profile !== profile) throw new Error(`app reports profile ${info.profile}, asked for ${profile} (old build? run npm run build)`);
const run = { started_at: new Date().toISOString(), gpu: info.gpu, angle: process.env.ANGLE ?? 'gl', profile, size: [width, height],
  frames, fps, app_commit: appCommit(), samples: samplesPath, todo: todo.length };
appendFileSync(join(outDir, 'runs.jsonl'), JSON.stringify(run) + '\n');
console.log(`gpu: ${info.gpu}; ${width}x${height}; ${frames} frames @ ${fps} fps; profile ${profile}`);

// Errors from booting the app are reported, not fatal; one during a still fails the run.
const bootErrors = errors.length;
if (bootErrors) console.warn(`page reported ${bootErrors} error(s) while loading: ${errors.slice(0, 3).join(' | ')}`);
let blank = 0;
const t0 = Date.now();
try {
  for (let k = 0; k < todo.length; k++) {
    const s = todo[k];
    const src = sources[s.source];
    const t = Date.now();
    const r = await page.evaluate((arg) => window.__ruttOffline.still(arg),
      { patch: { ...src.settings, ...s.patch }, image: imageUrl[s.source] ?? null, seed: s.seed, frames });
    if (errors.length > bootErrors) throw new Error(`page error at ${s.id}: ${errors.slice(bootErrors, bootErrors + 3).join(' | ')}`);
    writeFileSync(join(outDir, `${s.id}.png`), Buffer.from(r.png, 'base64'));
    const ms = Date.now() - t;
    appendFileSync(manifestPath, JSON.stringify({ id: s.id, sha256: r.sha256, ms, mean: r.stats.mean, max: r.stats.max }) + '\n');
    if (r.stats.max < 0.02) blank++;
    if (k % 50 === 0 || k === todo.length - 1) console.log(`${k + 1}/${todo.length}  ${s.id}  ${ms} ms  mean ${r.stats.mean.toFixed(3)}  ${r.sha256.slice(0, 12)}`);
  }
} finally {
  await browser.close();
}
console.log(`done: ${todo.length} stills in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${blank} near-black (max luminance < 0.02)`);
