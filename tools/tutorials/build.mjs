// Generate the narrated video course.
//
//   node build.mjs                      every lesson in curriculum.mjs
//   node build.mjs sources look         just these lessons
//   node build.mjs --vtt                rewrite every lesson's captions (no re-recording)
//   node build.mjs --index              only rewrite manifest.json + the About page listing
//   options: --voice kokoro:af_heart | piper   --speed 1.0
//
// Per lesson:
// 1. TTS: one WAV per narration line (cached by voice+text); durations pace the tour.
// 2. Playwright drives the real app in headed Chrome (real GPU) at 1920×1080
//    with a painted cursor, recording video; each segment's start is stamped.
//    `pre(page, h)` runs first and is trimmed out (setup the viewer needn't see).
// 3. Captions (.vtt) from the same lines + timestamps.
// 4. ffmpeg: place each line at its timestamp, mux H.264 (NVENC) + AAC.
// Then public/tutorials/manifest.json (read by tutorials.html) and the
// video-course block in docs/about/10-tutorials.md are regenerated.

//
// Needs `npm run dev` on :5190 in the repo root, `npm install` here, and the
// .venv (piper-tts, kokoro-onnx, soundfile, imageio-ffmpeg) + voices/ models.

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LESSONS, TRACKS } from './curriculum.mjs';
import { helpers } from './lib/helpers.mjs';
import { startScreencast } from './lib/capture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const PY = path.join(HERE, '.venv', 'Scripts', 'python.exe');
const APP_URL = process.env.APP_URL ?? 'http://localhost:5190/';
const DEST_ARG = (() => { const i = process.argv.indexOf('--dest'); return i >= 0 ? path.resolve(process.argv[i + 1]) : null; })();
// --dest <dir>: write the videos somewhere else (e.g. to audition a voice) and
// leave public/tutorials, the manifest and the About list untouched.
// `node build.mjs promo` builds tours/promo.mjs — the 2–3 minute showpiece film. It is
// NOT part of the course: it never touches the manifest or the About list and lands in
// out/promo/ (copy it where it is needed).
// The promo can share a run with lessons: lessons still go to public/tutorials (and the manifest
// is written for them), the promo to out/promo. (Once, every lesson in a run that included the promo
// landed in out/promo, and the promo's own scratch folder — the same out/promo — then wiped them.)
const PROMO_LESSON = { id: 'promo', number: '', level: '', track: '', title: 'Rutt/Etra Web — promo' };
const DEST = DEST_ARG ?? path.join(REPO, 'public', 'tutorials');   // served at /tutorials/ (MP4s are gitignored; upload them separately)
const W = 1920, H = 1080;
const PAD_MS = 450;          // breath after each line
const LEAD_MS = 700;         // picture before the first word
const TAIL_MS = 2200;        // picture after the last word

// Secrets live in tools/tutorials/.env (gitignored; see .env.example), never in
// the repo or the command line. A tiny KEY=VALUE reader — no dependency — that
// never overrides a variable already set in the environment.
try {
  for (const line of fs.readFileSync(path.join(HERE, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] && !m[1].startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env: fine */ }

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : dflt; };
const VOICE = opt('--voice', 'kokoro:af_heart');
opt('--dest', null);   // consumed above (DEST_ARG); keep it out of the lesson-id list
const SPEED = Number(opt('--speed', '1.0'));
const VTT_ONLY = args.includes('--vtt');   // rewrite captions from saved timings
const indexOnly = args.includes('--index');
const DRY = args.includes('--dry');
// Capture: Chrome's own screencast as full-quality JPEG frames -> one H.264 encode (sharp scan
// lines, no VP8 noise). `--playwright-video` falls back to Playwright's built-in recorder.
const HQ = !args.includes('--playwright-video');   // validate a tour fast: no TTS, recording or encoding
const ids = args.filter((a) => !a.startsWith('--'));
const todo = indexOnly ? [] : ids.length ? ids.map((id) => {
  const l = id === 'promo' ? PROMO_LESSON : LESSONS.find((x) => x.id === id);
  if (!l) throw new Error(`unknown lesson ${id}`);
  return l;
}) : LESSONS;

const PROMO_DEST = DEST_ARG ?? path.join(HERE, 'out', 'promo');
const destFor = (lesson) => (lesson.id === 'promo' ? PROMO_DEST : DEST);
fs.mkdirSync(DEST, { recursive: true });
fs.mkdirSync(PROMO_DEST, { recursive: true });
const ffmpeg = execFileSync(PY, ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())']).toString().trim();

// ---- fixtures ---------------------------------------------------------------
// A neutral moving clip for lessons that load a video FILE (no webcam needed).
const FIXTURES = path.join(HERE, 'fixtures');
const CLIP = path.join(FIXTURES, 'clip.mp4');
if (!fs.existsSync(CLIP)) {
  fs.mkdirSync(FIXTURES, { recursive: true });
  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'gradients=size=1280x720:rate=30:n=5:speed=0.015:type=spiral:c0=black:c1=white:c2=0x303030:c3=0xd0d0d0:c4=black', '-t', '40',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', CLIP]);
}

// ---- TTS --------------------------------------------------------------------
const TTS_CACHE = path.join(HERE, 'out', 'tts-cache');
fs.mkdirSync(TTS_CACHE, { recursive: true });

function wavDurationMs(file) {
  const b = fs.readFileSync(file);
  const byteRate = b.readUInt32LE(28);
  let off = 12;
  while (off < b.length - 8) {
    const idc = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (idc === 'data') return (Math.min(size, b.length - off - 8) / byteRate) * 1000;
    off += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${file}`);
}

/** Synthesize every uncached line in one go; returns [{wav, ms}] in order. */
async function speakAll(texts) {
  const [engine, voice] = VOICE.split(':');
  const jobs = texts.map((text) => {
    const key = crypto.createHash('sha1').update(`${VOICE}|${SPEED}|${text}`).digest('hex').slice(0, 16);
    return { text, out: path.join(TTS_CACHE, `${key}.wav`) };
  });
  const todo = jobs.filter((j) => !fs.existsSync(j.out));
  if (todo.length && engine === 'kokoro') {
    const jf = path.join(TTS_CACHE, 'jobs.json');
    fs.writeFileSync(jf, JSON.stringify(todo.map((j) => ({ ...j, voice: voice ?? 'af_heart', speed: SPEED }))));
    execFileSync(PY, [path.join(HERE, 'tts_kokoro.py'), jf], { stdio: ['ignore', 'ignore', 'inherit'] });
  } else if (todo.length && engine === 'piper') {
    for (const j of todo) {
      execFileSync(PY, ['-m', 'piper', '-m', path.join(HERE, 'voices', `${voice ?? 'en_US-lessac-medium'}.onnx`), '-f', j.out,
        '--length-scale', String(1 / SPEED), '--sentence-silence', '0.15'], { input: j.text });
    }
  } else if (todo.length && engine === 'elevenlabs') {
    for (const j of todo) await elevenLabsSpeak(voice, j.text, j.out);
  } else if (todo.length) throw new Error(`unknown voice engine ${engine}`);
  return jobs.map((j) => ({ wav: j.out, ms: wavDurationMs(j.out) }));
}

/**
 * ElevenLabs text-to-speech: `--voice elevenlabs:<voiceId>`. The key comes
 * from ELEVENLABS_API_KEY (tools/tutorials/.env) and is only ever sent as the
 * `xi-api-key` header — never logged. The MP3 it returns is converted to the
 * 48 kHz mono WAV the rest of the pipeline expects. Every line is cached by
 * voice+speed+text (speakAll), so a re-run only pays for lines that changed.
 */
async function elevenLabsSpeak(voiceId, text, outWav) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set — put it in tools/tutorials/.env');
  if (!voiceId) throw new Error('give a voice id: --voice elevenlabs:<voiceId>');
  const model = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text, model_id: model,
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true, speed: Math.max(0.7, Math.min(1.2, SPEED)) },
      }),
    });
    if (res.ok) {
      const mp3 = outWav.replace(/\.wav$/, '.mp3');
      fs.writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
      execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', mp3, '-ar', '48000', '-ac', '1', outWav]);
      fs.rmSync(mp3, { force: true });
      return;
    }
    const body = (await res.text()).slice(0, 300);
    // 429 = too many concurrent/rapid requests: back off and retry.
    if ((res.status === 429 || res.status >= 500) && attempt < 5) { await new Promise((r) => setTimeout(r, 1500 * attempt)); continue; }
    throw new Error(`ElevenLabs ${res.status}: ${body}`);
  }
}

// ---- recording ----------------------------------------------------------------
// Playwright's mouse doesn't move the OS cursor and the recording wouldn't
// show one anyway, so paint our own (plus a click ring: green left, amber right).
const CURSOR_SCRIPT = `
addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div');
  c.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M3 2 L3 22 L8.5 17 L12.5 26 L16 24.5 L12 15.8 L19.5 15.8 Z" fill="#e8ffe8" stroke="#0a120a" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none',
    transform: 'translate(-100px,-100px)', filter: 'drop-shadow(0 0 4px rgba(0,0,0,.8))' });
  document.documentElement.appendChild(c);
  const move = (e) => { c.style.transform = 'translate(' + (e.clientX - 3) + 'px,' + (e.clientY - 2) + 'px)'; };
  addEventListener('pointermove', move, true);
  addEventListener('pointerdown', (e) => {
    move(e);
    const r = document.createElement('div');
    Object.assign(r.style, { position: 'fixed', left: (e.clientX - 18) + 'px', top: (e.clientY - 18) + 'px', width: '36px', height: '36px',
      borderRadius: '50%', border: '2px solid ' + (e.button === 2 ? '#ffb347' : '#7dff9a'), zIndex: '2147483646', pointerEvents: 'none',
      transition: 'transform .45s ease-out, opacity .45s ease-out' });
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(1.8)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 600);
  }, true);
});`;

// Phone lessons paint a fingertip instead of an arrow: a soft disc that
// presses (shrinks) while a button is down, with the same click ring.
const TOUCH_SCRIPT = `
addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div');
  Object.assign(c.style, { position: 'fixed', left: '0', top: '0', width: '34px', height: '34px', marginLeft: '-17px', marginTop: '-17px',
    borderRadius: '50%', background: 'rgba(255,255,255,.28)', border: '2px solid rgba(255,255,255,.75)', zIndex: '2147483647',
    pointerEvents: 'none', transform: 'translate(-100px,-100px)', transition: 'width .12s, height .12s, margin .12s, background .12s' });
  document.documentElement.appendChild(c);
  const move = (e) => { c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)'; };
  const size = (px, bg) => { c.style.width = c.style.height = px + 'px'; c.style.marginLeft = c.style.marginTop = (-px / 2) + 'px'; c.style.background = bg; };
  addEventListener('pointermove', move, true);
  addEventListener('pointerdown', (e) => { move(e); size(26, 'rgba(95,255,133,.55)'); }, true);
  addEventListener('pointerup', () => size(34, 'rgba(255,255,255,.28)'), true);
});`;

async function record(lesson) {
  const tour = await import(`./tours/${lesson.id}.mjs?t=${Date.now()}`);
  const work = path.join(HERE, 'out', lesson.id === 'promo' ? 'promo-work' : lesson.id);   // never the output folder
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });

  const spoken = DRY ? null : await speakAll(tour.lines.map((l) => l.text));
  const lines = tour.lines.map((l, i) => ({ ...l, ...(DRY ? { ms: 400 } : spoken[i]) }));
  const byId = new Map(lines.map((l) => [l.id, l]));
  console.log(`[${lesson.id}] tts: ${lines.length} lines, ${(lines.reduce((s, l) => s + l.ms, 0) / 1000).toFixed(1)}s`);

  // A lesson may record at its own size (the phone lesson is portrait) and
  // against its own URL query (e.g. ?layout=compact).
  const vp = tour.viewport ?? { width: W, height: H };
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: [`--window-size=${vp.width + 20},${vp.height + 140}`, '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
      // Keep rendering at full rate even if another window covers this one.
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
      // Lessons that need a camera or mic get Chrome's fake devices (a test
      // pattern + a beeping tone) with permission prompts auto-accepted.
      ...(tour.fakeMedia ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : [])],
  });
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    ...(DRY || HQ ? {} : { recordVideo: { dir: work, size: { width: vp.width, height: vp.height } } }),
  });
  // Tours were written when child groups were always expanded: start them open (widgets.ts group()).
  await ctx.addInitScript(() => { try { localStorage.setItem('rw-groups-default', 'open'); } catch {} });
  if (!tour.noCursor) await ctx.addInitScript(tour.touch ? TOUCH_SCRIPT : CURSOR_SCRIPT);
  // Per-lesson hooks: page scripts (e.g. a fake MIDI device) and setup for
  // helper servers (e.g. a WebSocket standing in for the OSC/MCP bridge).
  for (const script of tour.initScripts ?? []) await ctx.addInitScript(script);
  const teardown = tour.setup ? await tour.setup({ ctx }) : null;
  const page = await ctx.newPage();
  const cap = !DRY && HQ ? await startScreencast(ctx, page, work, vp) : null;
  const t0 = Date.now();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.type() === 'prompt' ? d.accept(tour.promptAnswer ?? 'Tutorial') : d.accept());

  const h = helpers(page);
  h.fixtures = { clip: CLIP };
  const stamps = [];
  let failure = null;
  try {
    await page.goto(APP_URL + (tour.appQuery ?? ''));
    await page.waitForSelector('#rw-splash', { state: 'detached', timeout: 60000 });
    await page.waitForTimeout(600);
    // The panel auto-opens its Help tab once that lazy section mounts; every
    // lesson starts on Synth instead (switching away also marks Help seen,
    // so it doesn't come back). Lessons that need I/O or Help click there.
    if (!tour.viewport) {   // the side panel exists only in the desktop layout
      await page.waitForFunction(() => [...document.querySelectorAll('#panel-root .rw-section-head span')]
        .some((e) => e.textContent.trim() === 'Manual'), null, { timeout: 15000 }).catch(() => {});
      await page.click('#panel-root .rw-tab[data-tab="synth"]').catch(() => {});
    }
    if (tour.pre) await tour.pre(page, h);
    await page.mouse.move(vp.width / 2, vp.height / 2);
    await page.waitForTimeout(400);

    let current = '(before the first segment)';
    const seg = async (id, fn) => {
      const line = byId.get(id);
      if (!line) throw new Error(`segment ${id} has no narration line`);
      const start = Date.now() - t0;
      stamps.push({ id, start });
      current = id;
      if (stamps.length === 1 && !tour.noCard) await h.card(`LESSON ${lesson.number} · ${lesson.level.toUpperCase()} · ${lesson.track.toUpperCase()}`, lesson.title, Math.min(2600, line.ms - 300));
      await fn();
      const left = start + line.ms + PAD_MS - (Date.now() - t0);
      if (left > 0) await page.waitForTimeout(left);
    };
    await page.waitForTimeout(LEAD_MS);
    // Watchdog: a tour that stalls must fail, not record for hours (the promo once ran 90 min).
    let dog;
    const limit = new Promise((_, rej) => { dog = setTimeout(() => rej(new Error(`tour stalled in segment "${current}" (over 10 min)`)), 10 * 60_000); });
    try { await Promise.race([tour.run(page, seg, h), limit]); }
    catch (e) { await page.screenshot({ path: path.join(HERE, "out", `fail-${lesson.id}.png`) }).catch(() => {}); throw e; }
    finally { clearTimeout(dog); }
    await page.waitForTimeout(TAIL_MS);
  } catch (e) {
    failure = e;
    await page.screenshot({ path: path.join(work, 'failure.png') }).catch(() => {});
  }
  const tEnd = Date.now() - t0;
  await teardown?.();
  const video = HQ ? null : page.video();
  const capList = cap ? await cap.finish(t0, t0 + tEnd) : null;
  await ctx.close();
  await browser.close();
  if (errors.length) console.warn(`[${lesson.id}] page errors:\n  ${errors.slice(0, 8).join('\n  ')}`);
  if (failure) throw failure;
  if (DRY) { console.log(`[${lesson.id}] dry run ok (${stamps.length} segments)`); return; }
  const rawVideo = capList ?? await video.path();

  // ---- captions
  const trimMs = Math.max(0, stamps[0].start - LEAD_MS);
  writeVtt(lesson.id, stamps, byId, trimMs);

  // ---- mux
  const durS = ((tEnd - trimMs) / 1000).toFixed(3);
  const inputs = ['-ss', (trimMs / 1000).toFixed(3), ...(capList ? ['-f', 'concat', '-safe', '0'] : []), '-i', rawVideo];
  const filters = [];
  // JPEG frames are full-range BT.601; deliver standard limited-range BT.709 (correct colours in every player).
  if (capList) filters.push('[0:v]fps=30,scale=in_range=pc:in_color_matrix=bt601:out_range=tv:out_color_matrix=bt709:flags=lanczos+accurate_rnd,format=yuv420p[vout]');
  stamps.forEach((s, i) => {
    inputs.push('-i', byId.get(s.id).wav);
    const d = Math.round(s.start - trimMs);
    filters.push(`[${i + 1}:a]aresample=48000,adelay=${d}|${d}[a${i}]`);
  });
  filters.push(`${stamps.map((_, i) => `[a${i}]`).join('')}amix=inputs=${stamps.length}:normalize=0,apad[aout]`);
  const mp4 = path.join(destFor(lesson), `${lesson.id}.mp4`);
  execFileSync(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', capList ? '[vout]' : '0:v', '-map', '[aout]', '-t', durS,
    // Quality over size: constant-quality VBR (cq 21) with a generous ceiling so the fine scan
    // lines stay clean; ~6–8 Mbit/s on these pictures (≈ 50–60 MB a minute, ~1.8 GB for the whole course).
    '-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', '21', '-b:v', '0', '-maxrate', '11M', '-bufsize', '22M',
    '-spatial_aq', '1', '-temporal_aq', '1', '-rc-lookahead', '24', '-profile:v', 'high', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
    '-movflags', '+faststart',
    mp4,
  ]);
  if (tour.music) {
    // A quiet synthesized bed (slow-swelling A-minor add9 drone) under the narration:
    // written next to the plain cut as <id>-music.mp4 so either can be used.
    const dur = Number(durS);
    const tone = (f) => `sine=f=${f}:d=${dur}:r=48000`;
    const out = path.join(destFor(lesson), `${lesson.id}-music.mp4`);
    execFileSync(ffmpeg, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', mp4,
      '-f', 'lavfi', '-i', tone(110), '-f', 'lavfi', '-i', tone(164.81), '-f', 'lavfi', '-i', tone(220), '-f', 'lavfi', '-i', tone(246.94), '-f', 'lavfi', '-i', tone(329.63),
      '-filter_complex',
      `[1][2][3][4][5]amix=inputs=5:normalize=0,lowpass=f=900,tremolo=f=0.11:d=0.55,aecho=0.8:0.7:900|1700:0.35|0.2,volume=0.09,afade=t=in:d=3,afade=t=out:st=${Math.max(0, dur - 5)}:d=5[bed];` +
      `[0:a][bed]amix=inputs=2:normalize=0:duration=first[a]`,
      '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out,
    ]);
  }
  const posterId = tour.poster ?? stamps[Math.floor(stamps.length / 2)].id;
  const ps = stamps.find((s) => s.id === posterId) ?? stamps[0];
  execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-ss', ((ps.start - trimMs + 2500) / 1000).toFixed(2),
    '-i', mp4, '-frames:v', '1', '-q:v', '3', path.join(destFor(lesson), `${lesson.id}.jpg`)]);
  fs.writeFileSync(path.join(work, 'timings.json'), JSON.stringify({ trimMs, tEnd, stamps }, null, 1));
  built.set(lesson.id, {
    duration: Math.round((tEnd - trimMs) / 100) / 10,
    chapters: stamps.map((s) => ({ t: Math.round((s.start - trimMs) / 100) / 10, text: byId.get(s.id).text })),
  });
  console.log(`[${lesson.id}] done: ${durS}s, ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB`);
}

// ---- captions -----------------------------------------------------------------
/**
 * One cue per sentence (a whole narration line can run three caption lines
 * deep over the picture). A line's time is shared out by character count,
 * which tracks TTS speaking time closely enough for captions.
 */
function writeVtt(id, stamps, byId, trimMs) {
  const fmt = (ms) => {
    const t = Math.max(0, ms);
    const hh = Math.floor(t / 3.6e6), m = Math.floor(t / 6e4) % 60, s = Math.floor(t / 1000) % 60, f = Math.floor(t % 1000);
    return `${String(hh).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(f).padStart(3, '0')}`;
  };
  const cues = [];
  for (const s of stamps) {
    const l = byId.get(s.id);
    const sentences = l.text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g).map((x) => x.trim()).filter(Boolean);
    const total = sentences.reduce((n, x) => n + x.length, 0);
    let a = s.start - trimMs;
    for (const x of sentences) {
      const d = l.ms * (x.length / total);
      cues.push(`${cues.length + 1}\n${fmt(a)} --> ${fmt(a + d)}\n${x}\n`);
      a += d;
    }
  }
  fs.writeFileSync(path.join(id === 'promo' ? PROMO_DEST : DEST, `${id}.vtt`), `WEBVTT\n\n${cues.join('\n')}`);
}

/** --vtt: rewrite captions from saved timings (no re-recording; TTS is cached). */
async function rewriteVtt(lesson) {
  const t = JSON.parse(fs.readFileSync(path.join(HERE, 'out', lesson.id, 'timings.json'), 'utf8'));
  const tour = await import(`./tours/${lesson.id}.mjs`);
  const spoken = await speakAll(tour.lines.map((l) => l.text));
  const byId = new Map(tour.lines.map((l, i) => [l.id, { ...l, ...spoken[i] }]));
  writeVtt(lesson.id, t.stamps, byId, t.trimMs);
  console.log(`[${lesson.id}] captions rewritten`);
}

// ---- manifest + About page listing -----------------------------------------
const built = new Map();   // lesson id -> { duration, chapters } from this run

/** Lesson timing from a previous run's out/<id>/timings.json (+ the tour's lines). */
async function savedMeta(id) {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(HERE, 'out', id, 'timings.json'), 'utf8'));
    const tour = await import(`./tours/${id}.mjs`);
    const text = new Map(tour.lines.map((l) => [l.id, l.text]));
    return {
      duration: Math.round((t.tEnd - t.trimMs) / 100) / 10,
      chapters: t.stamps.map((s) => ({ t: Math.round((s.start - t.trimMs) / 100) / 10, text: text.get(s.id) })),
    };
  } catch { return null; }
}

async function writeManifest() {
  for (const l of LESSONS) {
    if (!built.has(l.id) && fs.existsSync(path.join(DEST, `${l.id}.mp4`))) {
      const m = await savedMeta(l.id);
      if (m) built.set(l.id, m);
    }
  }
  // A lesson that records at its own size (the phone lesson) tells the page
  // its shape, so the player can frame it before the video loads.
  const aspects = new Map();
  for (const l of LESSONS) {
    const t = await import(`./tours/${l.id}.mjs`);
    if (t.viewport) aspects.set(l.id, `${t.viewport.width} / ${t.viewport.height}`);
  }
  const file = path.join(DEST, 'manifest.json');
  let prev = {};
  try { prev = Object.fromEntries(JSON.parse(fs.readFileSync(file, 'utf8')).tracks.flatMap((t) => t.lessons).map((l) => [l.id, l])); } catch { /* first run */ }
  const manifest = {
    note: 'Generated by tools/tutorials/build.mjs from curriculum.mjs. Do not edit by hand.',
    voice: VOICE,
    tracks: TRACKS.map((t) => ({
      level: t.level,
      title: t.title,
      lessons: t.lessons.map((l) => {
        const L = LESSONS.find((x) => x.id === l.id);
        const meta = built.get(l.id) ?? (prev[l.id] ? { duration: prev[l.id].duration, chapters: prev[l.id].chapters } : null);
        return { id: l.id, number: L.number, title: l.title, blurb: l.blurb, ...(aspects.get(l.id) ? { aspect: aspects.get(l.id) } : {}), ...(meta ?? { duration: null, chapters: [] }) };
      }),
    })),
  };
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 1)}\n`);
}

function writeIndex() {
  const md = path.join(REPO, 'docs', 'about', '10-tutorials.md');
  const START = '<!-- video-course:start -->', END = '<!-- video-course:end -->';
  const parts = [START, '', '### Video course', '',
    'Short narrated lessons, each building on the one before, on the',
    '[Video Tutorials page](./tutorials.html) (also **Help ▸ Video Tutorials** in the app).', ''];
  let level = null;
  for (const t of TRACKS) {
    if (t.level !== level) { level = t.level; parts.push(`#### ${level}`, ''); }
    parts.push(`**${t.title}**`, '');
    for (const l of t.lessons) {
      const L = LESSONS.find((x) => x.id === l.id);
      parts.push(`${L.number}. [${l.title}](./tutorials.html#${l.id}) — ${l.blurb}`);
    }
    parts.push('');
  }
  parts.push(END);
  let src = fs.readFileSync(md, 'utf8');
  const block = parts.join('\n');
  if (src.includes(START)) src = src.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  else src = src.replace(/\n### /, `\n${block}\n\n### `);
  fs.writeFileSync(md, src);
}

const failed = [];
for (const l of todo) {
  try { await (VTT_ONLY ? rewriteVtt(l) : record(l)); } catch (e) { failed.push(l.id); console.error(`[${l.id}] FAILED: ${e.message}`); }
}
// The manifest/About list change only for real lessons into public/tutorials (not a promo-only run).
if (!DRY && DEST_ARG == null && (indexOnly || todo.some((l) => l.id !== 'promo'))) { await writeManifest(); writeIndex(); }
if (failed.length) { console.error(`failed: ${failed.join(', ')}`); process.exitCode = 1; }
