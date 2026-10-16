// Generates the pictures and clips behind every ⓘ panel (owner: "info panels need images and/or
// videos; text is there to support them" — GUI support for a GUI).
//
//   node info-media.mjs shots           screenshots of every Controls section + group (both tabs)
//   node info-media.mjs clips [filter]  looping clips of the effect on the live picture
//   node info-media.mjs all
//
// Output: public/info/{shot,clip}-<key>.{webp,mp4} + public/info/manifest.json, read by
// src/ui/help/infoMedia.ts. Everything is captured from the real app (Chrome, real GPU), so it
// cannot drift from the GUI it describes — re-run after a GUI change. Needs `npm run dev` on :5190.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { helpers } from './lib/helpers.mjs';
import { startScreencast } from './lib/capture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUT = path.join(REPO, 'public', 'info');
const WORK = path.join(HERE, 'out', 'info');
const APP = process.env.APP_URL ?? 'http://localhost:5190/';
const PY = path.join(HERE, '.venv', 'Scripts', 'python.exe');
const ffmpeg = execFileSync(PY, ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())']).toString().trim();
const MODE = process.argv[2] ?? 'all';
const FILTER = process.argv[3] ?? '';

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(WORK, { recursive: true });

// Same slug + key scheme as src/ui/help/infoContent.ts (`mediaKeys`).
const slug = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const keys = {
  section: (t) => `section.${slug(t)}`,
  group: (s, t) => `group.${slug(s ?? 'panel')}.${slug(t)}`,
};
const fileSafe = (k) => k.replace(/[^a-z0-9.-]/g, '-');

const manifestPath = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const save = () => fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 1)}\n`);
const note = (key, patch) => { manifest[key] = { ...(manifest[key] ?? {}), ...patch }; };

const LAUNCH = {
  channel: 'chrome', headless: false,
  args: ['--window-size=1940,1220', '--ignore-gpu-blocklist', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
};

async function openApp(ctx) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(APP);
  await page.waitForSelector('#rw-splash', { state: 'detached', timeout: 60000 });
  await page.waitForTimeout(500);
  await page.click('#boot-pattern');
  await page.waitForTimeout(1500);
  return { page, h: helpers(page), errors };
}

const toWebp = (png, webp) => {
  try {
    execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', png, '-c:v', 'libwebp', '-quality', '86', '-compression_level', '6', webp]);
    fs.rmSync(png, { force: true });
    return path.basename(webp);
  } catch { return path.basename(png); }     // no libwebp: keep the PNG
};

// ------------------------------------------------------------------ shots
async function shots() {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const { page, h, errors } = await openApp(ctx);
  let n = 0;
  for (const tab of ['synth', 'io']) {
    await page.click(`#panel-root .rw-tab[data-tab="${tab}"]`);
    await page.waitForTimeout(400);
    const titles = await page.evaluate(() => [...document.querySelectorAll('#panel-root .rw-section-head > span:first-child')]
      .filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim()));
    for (const title of titles) {
      if (title === 'Manual') continue;
      try {
        await h.section(title);
        await page.waitForTimeout(500);
        const sec = page.locator('#panel-root .rw-section').filter({ has: page.locator(`:scope > .rw-section-head > span:text-is("${title}")`) }).first();
        // The section: its header and the first 760px (long sections get a crop, never a scroll of pixels).
        const box = await sec.boundingBox();
        if (box) {
          const png = path.join(OUT, `shot-${fileSafe(keys.section(title))}.png`);
          await page.screenshot({ path: png, clip: { x: box.x, y: Math.max(0, box.y), width: box.width, height: Math.min(box.height, 760) } });
          note(keys.section(title), { shot: toWebp(png, png.replace(/\.png$/, '.webp')), shotCaption: `${title} in the Controls panel` });
          n++;
        }
        const groups = sec.locator('.rw-group');
        const count = await groups.count();
        for (let i = 0; i < count; i++) {
          const g = groups.nth(i);
          const gt = (await g.locator('.rw-group-head').first().textContent())?.trim();
          if (!gt || !(await g.isVisible())) continue;
          const png = path.join(OUT, `shot-${fileSafe(keys.group(title, gt))}.png`);
          await g.screenshot({ path: png, animations: 'disabled' });
          note(keys.group(title, gt), { shot: toWebp(png, png.replace(/\.png$/, '.webp')), shotCaption: `${gt} — ${title} section` });
          n++;
        }
        await h.click('#panel-root .rw-section-head > span:first-child', title, { exact: true, steps: 6, pause: 40 }).catch(() => {});   // collapse again
      } catch (e) { console.warn(`[shots] ${title}: ${e.message.split('\n')[0]}`); }
    }
  }
  save();
  console.log(`[shots] ${n} screenshots${errors.length ? `, page errors: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}

// ------------------------------------------------------------------ clips
// A step is [op, ...args]: ['ramp', key, to, ms] · ['set', key, v] · ['select', key, value] ·
// ['toggle', key] · ['chip', name] · ['orbit', dx, dy, ms] · ['wait', ms]. Every demo returns the
// picture to where it started, so the clip loops without a jump.
const R = (key, from, to, ms = 1300) => [['ramp', key, to, ms], ['wait', 250], ['ramp', key, from, ms]];

const DEMOS = {
  // ---- Display Control Unit
  [keys.group('Display Control Unit', 'Position & Size')]: [...R('hSize', 1, 0.55), ...R('hPos', 0, 0.3, 1000)],
  [keys.group('Display Control Unit', 'Depth (Z) — Brightness Displacement')]: [...R('zPush', 0.9, 3.4, 1500), ...R('zBias', 0, 0.5, 1000)],
  [keys.group('Display Control Unit', 'Beam')]: [...R('intensity', 0.85, 0.2, 1100), ...R('focus', 0.1, 0.9, 1100)],
  [keys.group('Display Control Unit', 'Rotation')]: [...R('rotation', 0, 0.9, 1700)],
  [keys.group('Display Control Unit', 'Scan')]: [...R('skip', 0, 6, 1600)],
  [keys.group('Display Control Unit', 'Linearity')]: [...R('hLinearity', 0, 0.8, 1300), ...R('vLinearity', 0, -0.8, 1300)],
  [keys.group('Display Control Unit', 'Luminance Shaping')]: [...R('threshold', 0.04, 0.5, 1200), ...R('contrast', 1, 2.4, 1100)],
  [keys.section('Display Control Unit')]: [...R('zPush', 0.9, 2.8, 1000), ...R('hSize', 1, 0.6, 900), ...R('rotation', 0, 0.7, 1000), ...R('hLinearity', 0, 0.6, 900)],
  // ---- Color / Post FX
  [keys.group('Color / Post FX', 'Color')]: [['select', 'colorMode', 'phosphorAmber'], ['wait', 1100], ['select', 'colorMode', 'grayscale'], ['wait', 1100], ['select', 'colorMode', 'phosphorGreen'], ['wait', 600]],
  [keys.group('Color / Post FX', 'Bloom (Phosphor Glow)')]: [...R('bloomIntensity', 0.5, 1.7, 1500)],
  [keys.group('Color / Post FX', 'Burn-In Feedback')]: [['toggle', 'feedbackEnabled'], ['orbit', 160, 40, 1700], ['orbit', -160, -40, 1700], ['toggle', 'feedbackEnabled'], ['wait', 600]],
  [keys.group('Color / Post FX', 'Analog Character')]: [...R('analogNoise', 0.15, 0.7, 1300), ...R('analogDropout', 0.1, 0.6, 1300)],
  [keys.group('Color / Post FX', 'Chromatic Aberration')]: [...R('chromaAmount', 0.0025, 0.02, 1500)],
  [keys.group('Color / Post FX', 'Scanline Overlay')]: [...R('scanlineIntensity', 0.15, 0.85, 1300), ...R('scanlineDensity', 720, 220, 1100)],
  [keys.group('Color / Post FX', 'Vignette')]: [...R('vignetteAmount', 0.5, 1, 1400)],
  [keys.section('Color / Post FX')]: [['select', 'colorMode', 'phosphorAmber'], ...R('bloomIntensity', 0.5, 1.4, 900), ...R('chromaAmount', 0.0025, 0.015, 900), ['select', 'colorMode', 'phosphorGreen'], ['wait', 400]],
  // ---- Virtual Camera
  [keys.group('Virtual Camera', 'Mode')]: [['orbit', 220, 60, 1600], ['orbit', -220, -60, 1600]],
  [keys.group('Virtual Camera', 'Lens')]: [...R('cameraFov', 50, 105, 1500)],
  [keys.group('Virtual Camera', 'Auto-orbit')]: [['toggle', 'autoOrbit'], ['wait', 3200], ['toggle', 'autoOrbit'], ['wait', 300]],
  [keys.group('Virtual Camera', 'Anaglyph 3D')]: [['toggle', 'anaglyphEnabled'], ['orbit', 140, 30, 1600], ['orbit', -140, -30, 1600], ['toggle', 'anaglyphEnabled'], ['wait', 300]],
  [keys.section('Virtual Camera')]: [['orbit', 220, 60, 1400], ...R('cameraFov', 50, 95, 1000), ['orbit', -220, -60, 1400]],
  // ---- Dual Raster
  [keys.group('Dual Raster', 'Dual Trace')]: [['toggle', 'dualRasterEnabled'], ...R('dualTracePos', 0, 1, 1500), ['toggle', 'dualRasterEnabled'], ['wait', 300]],
  [keys.group('Dual Raster', 'B · Depth & Beam')]: [['toggle', 'dualRasterEnabled'], ['select', 'dualMode', 'alternate'], ...R('bZPush', 0.9, -1.4, 1500), ['toggle', 'dualRasterEnabled'], ['wait', 300]],
  [keys.group('Dual Raster', 'B · Rotation')]: [['toggle', 'dualRasterEnabled'], ['select', 'dualMode', 'alternate'], ...R('bRotation', 0, 0.9, 1500), ['toggle', 'dualRasterEnabled'], ['wait', 300]],
  [keys.group('Dual Raster', 'B · Position & Size')]: [['toggle', 'dualRasterEnabled'], ['select', 'dualMode', 'alternate'], ...R('bHSize', 1, 0.6, 1400), ['toggle', 'dualRasterEnabled'], ['wait', 300]],
  [keys.section('Dual Raster')]: [['toggle', 'dualRasterEnabled'], ['select', 'dualMode', 'alternate'], ...R('bZPush', 0.9, -1.2, 1300), ['toggle', 'dualRasterEnabled'], ['wait', 300]],
  // ---- Video Source A
  [keys.group('Video Source A', 'Pattern Generator')]: [['toggle', 'patternEnabled'], ['selectRow', 'Pattern Generator', 'Kind', 'lissajous'], ['wait', 1100], ['selectRow', 'Pattern Generator', 'Kind', 'spiral'], ['wait', 1100], ['selectRow', 'Pattern Generator', 'Kind', 'worleyNoise'], ['wait', 1100], ['toggle', 'patternEnabled'], ['wait', 300]],
  [keys.section('Video Source A')]: [['toggle', 'patternEnabled'], ['selectRow', 'Pattern Generator', 'Kind', 'lissajous'], ['wait', 1000], ['selectRow', 'Pattern Generator', 'Kind', 'worleyNoise'], ['wait', 1000], ['toggle', 'patternEnabled'], ['wait', 300]],
  // ---- Geometry / Presets
  [keys.section('Geometry')]: [['select', 'renderMode', 'dots'], ['wait', 1200], ['select', 'renderMode', 'wireframe'], ['wait', 1200], ['select', 'renderMode', 'scanlines'], ['wait', 500]],
  [keys.group('Geometry', 'Render Mode')]: [['select', 'renderMode', 'dots'], ['wait', 1200], ['select', 'renderMode', 'wireframe'], ['wait', 1200], ['select', 'renderMode', 'scanlines'], ['wait', 500]],
  [keys.section('Presets')]: [['chip', 'Amber Terminal'], ['wait', 1000], ['chip', 'Wireframe'], ['wait', 1000], ['chip', 'Burn-In'], ['wait', 1000], ['chip', 'Classic 1974'], ['wait', 600]],
  [keys.group('Presets', 'Built-in Presets')]: [['chip', 'Amber Terminal'], ['wait', 1000], ['chip', 'Wireframe'], ['wait', 1000], ['chip', 'Burn-In'], ['wait', 1000], ['chip', 'Classic 1974'], ['wait', 600]],
};

async function runStep(page, h, step) {
  const [op, a, b, c] = step;
  switch (op) {
    case 'wait': return h.wait(a);
    case 'set': case 'ramp': {
      // One in-page animation (rAF, eased) so the move takes exactly `ms` however slow the host is.
      const ms = op === 'set' ? 0 : c;
      return page.evaluate(([k, to, dur]) => new Promise((resolve, reject) => {
        const r = document.querySelector(`#panel-root [data-param-key="${k}"] input[type=range]`);
        if (!r) { reject(new Error(`no range for ${k}`)); return; }
        const from = +r.value;
        const put = (v) => { r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); };
        if (!dur) { put(to); resolve(); return; }
        const t0 = performance.now();
        const tick = (now) => {
          const u = Math.min(1, (now - t0) / dur);
          const e = u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2;   // ease in-out
          put(from + (to - from) * e);
          if (u < 1) requestAnimationFrame(tick); else resolve();
        };
        requestAnimationFrame(tick);
      }), [a, b, ms]);
    }
    case 'select': return page.evaluate(([k, v]) => {
      const s = document.querySelector(`#panel-root select[data-param-key="${k}"]`);
      if (!s) throw new Error(`no select ${k}`);
      s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
    }, [a, b]);
    case 'selectRow': return page.evaluate(([grp, label, v]) => {
      const g = [...document.querySelectorAll('#panel-root .rw-group')].find((e) => e.querySelector('.rw-group-head')?.textContent.trim() === grp);
      const row = [...(g?.querySelectorAll('.rw-row') ?? [])].find((r) => r.querySelector('.rw-label')?.textContent.trim() === label);
      const s = row?.querySelector('select');
      if (!s) throw new Error(`no select ${grp} / ${label}`);
      s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
    }, [a, b, c]);
    case 'toggle': return page.evaluate((k) => {
      const i = document.querySelector(`#panel-root .rw-toggle[data-param-key="${k}"] input`);
      if (!i) throw new Error(`no toggle ${k}`);
      i.click();
    }, a);
    case 'chip': return page.evaluate((n) => { [...document.querySelectorAll('#panel-root .rw-preset-chip')].find((c2) => c2.textContent.trim() === n)?.click(); }, a);
    case 'orbit': {
      const x0 = 960, y0 = 540;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x0 + a, y0 + b, { steps: Math.max(8, Math.round(c / 40)) });
      await page.mouse.up();
      return undefined;
    }
    default: throw new Error(`unknown step ${op}`);
  }
}

async function clips() {
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  let ok = 0;
  const failed = [];
  for (const [key, steps] of Object.entries(DEMOS)) {
    if (FILTER && !key.includes(FILTER)) continue;
    const dir = path.join(WORK, fileSafe(key));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const { page, h } = await openApp(ctx);
    let cap = null;
    try {
      await page.click('#rw-center-shell .rw-region-max-btn');       // the picture, full-bleed
      await h.wait(600);
      cap = await startScreencast(ctx, page, dir, { width: 1920, height: 1080 });
      const t0 = Date.now();
      await h.wait(350);
      for (const s of steps) await runStep(page, h, s);
      await h.wait(350);
      const list = await cap.finish(t0, Date.now());
      const mp4 = path.join(OUT, `clip-${fileSafe(key)}.mp4`);
      execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
        '-vf', 'fps=30,crop=1920:1022:0:58,scale=640:342:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27',
        '-an', '-movflags', '+faststart', mp4]);
      note(key, { clip: path.basename(mp4), caption: 'The effect on the live picture' });
      ok++;
      console.log(`[clip] ${key}  ${(fs.statSync(mp4).size / 1024).toFixed(0)} KB`);
    } catch (e) {
      failed.push(key);
      console.warn(`[clip] ${key}: ${e.message.split('\n')[0]}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      await page.close();
    }
  }
  save();
  console.log(`[clips] ${ok} written${failed.length ? `, ${failed.length} failed: ${failed.join(', ')}` : ''}`);
  await browser.close();
}

if (MODE === 'shots' || MODE === 'all') await shots();
if (MODE === 'clips' || MODE === 'all') await clips();
