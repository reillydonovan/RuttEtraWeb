#!/usr/bin/env node
// Offline render driver for RuttEtraWeb (?render=offline, src/render/offline.ts).
//
//   node render.mjs --job job.json --out out.mp4 [--from 0] [--to N] [--hashes hashes.json]
//   node render.mjs --job job.json --verify 60        (determinism test: render 60 frames twice)
//
// job.json (local file): { frames: "<dir of 00001.png...>", pad: 5, frameCount, fps, width, height,
// fft: "<fft_frames.bin>", project: "<.synth.json>" (optional), seed, playTimeline }
// Local paths in the job are served to the page through Playwright request interception at
// http://localhost:5199 (a secure context, so crypto.subtle works); no server is started.
// The app is the BUILT app in ../../dist (run `npm run build` first).
//
// Headed Chrome on purpose: headless can fall back to SwiftShader. The run FAILS if the
// WebGL renderer is not a real GPU. Frames go to ffmpeg as PNGs (lossless) on stdin.
//
// ANGLE on OpenGL by default (ANGLE=d3d11|vulkan to override). Measured on node-b's 3090 Ti,
// 2026-10-18, 60 frames rendered twice: OpenGL bit-identical (0 of 60 differ); D3D11 27 of 60
// and Vulkan 24 of 60 differ by +-1 in up to ~150 px a frame. Not MSAA (same with it off).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '../../dist');
const ORIGIN = 'http://localhost:5199';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.bin': 'application/octet-stream' };
const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|basic render|microsoft basic|software/i;

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const jobPath = resolve(opt('job'));
const job = JSON.parse(readFileSync(jobPath, 'utf8'));
const verify = Number(opt('verify', 0));
const from = Number(opt('from', 0));
const to = Number(opt('to', Math.round(job.frameCount) - 1));

// What the page sees: the same job, with local paths turned into /__job/ URLs.
const local = { frames: resolve(dirname(jobPath), job.frames), fft: resolve(dirname(jobPath), job.fft),
  project: job.project ? resolve(dirname(jobPath), job.project) : null };
const pageJob = { ...job, frames: '/__job/frames/{i}.png', fft: '/__job/fft.bin',
  project: local.project ? '/__job/project.json' : undefined };

function serve(route) {
  const url = new URL(route.request().url());
  let file;
  if (url.pathname === '/__job/job.json') return route.fulfill({ body: JSON.stringify(pageJob), contentType: 'application/json' });
  if (url.pathname === '/__job/fft.bin') file = local.fft;
  else if (url.pathname === '/__job/project.json') file = local.project;
  else if (url.pathname.startsWith('/__job/frames/')) file = join(local.frames, url.pathname.slice('/__job/frames/'.length));
  else file = join(DIST, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file || !existsSync(file) || !statSync(file).isFile()) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ body: readFileSync(file), contentType: MIME[extname(file)] ?? 'application/octet-stream' });
}

async function openRenderer() {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error(`no build at ${DIST}: run npm run build`);
  const browser = await chromium.launch({ channel: 'chrome', headless: false,
    args: [`--use-angle=${process.env.ANGLE ?? 'gl'}`, '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling', `--window-size=${Math.min(job.width, 1600) + 40},${Math.min(job.height, 1000) + 160}`] });
  const ctx = await browser.newContext({ viewport: { width: Math.min(job.width, 1600), height: Math.min(job.height, 1000) }, deviceScaleFactor: 1 });
  await ctx.route(`${ORIGIN}/**`, serve);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${ORIGIN}/?render=offline&job=/__job/job.json&seed=${job.seed ?? 1}`);
  await page.waitForFunction(() => document.title === 'ready' || !!window.__ruttOfflineError, null, { timeout: 120000 })
    .catch(() => { throw new Error(`renderer never became ready: ${errors.slice(0, 5).join(' | ')}`); });
  const info = await page.evaluate(() => ({ gpu: window.__ruttOffline.gpu, size: window.__ruttOffline.size(), timeline: window.__ruttOffline.timeline }));
  if (SOFTWARE_GL.test(info.gpu)) throw new Error(`WebGL is on a software renderer (${info.gpu}); refusing to render`);
  if (info.size[0] !== job.width || info.size[1] !== job.height) throw new Error(`canvas is ${info.size.join('x')}, job wants ${job.width}x${job.height}`);
  return { browser, page, info, errors };
}

async function renderRange(page, a, b, onFrame) {
  const hashes = [];
  for (let i = a; i <= b; i++) {
    const r = await page.evaluate((n) => window.__ruttOffline.renderFrame(n), i);
    hashes.push(r.sha256);
    if (onFrame) await onFrame(Buffer.from(r.png, 'base64'), i);
    if ((i - a) % 60 === 0) console.log(`frame ${i} / ${b}  ${r.sha256.slice(0, 12)}`);
  }
  return hashes;
}

if (verify) {
  const runs = [];
  for (let k = 0; k < 2; k++) {
    const { browser, page, info } = await openRenderer();
    console.log(`run ${k + 1}: gpu ${info.gpu}`);
    const dump = opt('dump');
    runs.push(await renderRange(page, 0, verify - 1, dump ? async (buf, i) => {
      const d = join(dump, `run${k + 1}`); (await import('node:fs')).mkdirSync(d, { recursive: true });
      writeFileSync(join(d, `${String(i).padStart(5, '0')}.png`), buf);
    } : undefined));
    await browser.close();
  }
  const diff = runs[0].map((h, i) => (h === runs[1][i] ? null : i)).filter((x) => x !== null);
  const report = { frames: verify, identical: diff.length === 0, differing_frames: diff.slice(0, 50),
    first_hashes: runs[0].slice(0, 3) };
  console.log(JSON.stringify(report, null, 1));
  if (opt('hashes')) writeFileSync(opt('hashes'), JSON.stringify(report, null, 1));
  process.exit(diff.length ? 1 : 0);
}

const out = resolve(opt('out'));
const { browser, page, info, errors } = await openRenderer();
console.log(`gpu: ${info.gpu}; ${job.width}x${job.height} @ ${job.fps} fps; frames ${from}-${to}; timeline ${info.timeline}`);
const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(job.fps), '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
  { stdio: ['pipe', 'inherit', 'inherit'] });
const write = (buf) => new Promise((res, rej) => ff.stdin.write(buf, (e) => (e ? rej(e) : res())));
const hashes = await renderRange(page, from, to, (buf) => write(buf));
ff.stdin.end();
await new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
await browser.close();
const manifest = { job: jobPath, out, gpu: info.gpu, from, to, fps: job.fps, size: [job.width, job.height],
  frame_sha256: hashes, all_sha256: createHash('sha256').update(hashes.join('')).digest('hex'),
  page_errors: errors.slice(0, 20), written_at: new Date().toISOString() };
writeFileSync(opt('hashes', out.replace(/\.mp4$/, '.render.json')), JSON.stringify(manifest, null, 1));
console.log(`done: ${out} (${hashes.length} frames), render manifest beside it`);
