#!/usr/bin/env node
// Offline render driver for RuttEtraWeb (?render=offline, src/render/offline.ts).
//
//   node render.mjs --job job.json --out out.mp4 [--from 0] [--to N] [--hashes hashes.json]
//   node render.mjs --job job.json --verify 60        (determinism test: render 60 frames twice)
//
// job.json (local file): { frames: "<dir of 00001.png...>", pad: 5, frameCount, fps, width, height,
// fft: "<fft_frames.bin>", project: "<.synth.json>" (optional), seed, playTimeline, profile }
// Local paths in the job are served to the page as /__job/ URLs. Browser, GPU check, ANGLE
// choice and the built app: ./browser.mjs. Frames go to ffmpeg ($FFMPEG, needs libx264) as
// PNGs on stdin.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { openOfflinePage, fulfillFile } from './browser.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const jobPath = resolve(opt('job'));
const job = JSON.parse(readFileSync(jobPath, 'utf8'));
const verify = Number(opt('verify', 0));
const from = Number(opt('from', 0));
const to = Number(opt('to', Math.round(job.frameCount) - 1));

// What the page sees: the same job, with local paths turned into /__job/ URLs.
const ext = job.ext ?? 'png'; // source frames may be jpg: 78 min of 4K PNGs would be ~1 TB
const local = { video: job.video ? resolve(dirname(jobPath), job.video) : null,
  frames: job.frames ? resolve(dirname(jobPath), job.frames) : null, fft: job.fft ? resolve(dirname(jobPath), job.fft) : null,
  project: job.project ? resolve(dirname(jobPath), job.project) : null };
const pageJob = { ...job, frames: local.frames ? `/__job/frames/{i}.${ext}` : undefined,
  video: local.video ? '/__job/video.mp4' : undefined, fft: local.fft ? '/__job/fft.bin' : undefined,
  project: local.project ? '/__job/project.json' : undefined };

// The source video can be tens of GB: serve it by byte range (mediabunny's UrlSource reads
// ranges), never whole.
function serveRange(route, file) {
  const size = statSync(file).size;
  const req = route.request();
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers()['range'] ?? '');
  const headers = { 'Accept-Ranges': 'bytes', 'Content-Type': 'video/mp4' };
  if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...headers, 'Content-Length': String(size) }, body: '' });
  const start = m ? Number(m[1]) : 0;
  const end = Math.min(size - 1, m && m[2] ? Number(m[2]) : start + 64 * 1024 * 1024 - 1);
  const buf = Buffer.alloc(end - start + 1);
  const fd = openSync(file, 'r');
  try { readSync(fd, buf, 0, buf.length, start); } finally { closeSync(fd); }
  return route.fulfill({ status: 206, body: buf,
    headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(buf.length) } });
}

function serve(route, url) {
  if (!url.pathname.startsWith('/__job/')) return undefined; // the built app
  if (url.pathname === '/__job/video.mp4' && local.video) return serveRange(route, local.video);
  if (url.pathname === '/__job/job.json') return route.fulfill({ body: JSON.stringify(pageJob), contentType: 'application/json' });
  let file = null;
  if (url.pathname === '/__job/fft.bin') file = local.fft;
  else if (url.pathname === '/__job/project.json') file = local.project;
  else if (url.pathname.startsWith('/__job/frames/') && local.frames) file = join(local.frames, url.pathname.slice('/__job/frames/'.length));
  return fulfillFile(route, file);
}

function openRenderer() {
  return openOfflinePage({ width: job.width, height: job.height, jobUrl: '/__job/job.json', seed: job.seed ?? 1, serve });
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
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
{ // fail naming the binary, not with ffmpeg's exit code, when it has no libx264 (e.g. a Topaz build on PATH)
  const { execFileSync } = await import('node:child_process');
  const enc = execFileSync(FFMPEG, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  if (!/ libx264 /.test(enc)) throw new Error(`${FFMPEG} has no libx264; set FFMPEG to a full build`);
}
const ff = spawn(FFMPEG, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(job.fps), '-i', '-',
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
