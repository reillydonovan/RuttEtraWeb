// The headed-Chrome harness shared by the offline drivers (render.mjs: video renders;
// ../copilot/stills.mjs: one still per look). It serves the BUILT app (../../dist; run
// `npm run build` first) and whatever the driver adds by Playwright request interception at
// http://localhost:5199 (a secure context, so crypto.subtle works); no server is started.
//
// Headed Chrome on purpose: headless can fall back to SwiftShader. Opening FAILS if the
// WebGL renderer is not a real GPU, or if the canvas is not the size the job asked for.
//
// ANGLE on OpenGL by default (ANGLE=d3d11|vulkan to override). Measured on node-b's 3090 Ti,
// 2026-10-18, 60 frames rendered twice: OpenGL bit-identical (0 of 60 differ); D3D11 27 of 60
// and Vulkan 24 of 60 differ by +-1 in up to ~150 px a frame. Not MSAA (same with it off).
import { chromium } from 'playwright';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DIST = resolve(HERE, '../../dist');
export const ORIGIN = 'http://localhost:5199';
export const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.bin': 'application/octet-stream' };
export const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|basic render|microsoft basic|software/i;

/** Answer with a local file, or 404 when there is none. */
export function fulfillFile(route, file) {
  if (!file || !existsSync(file) || !statSync(file).isFile()) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ body: readFileSync(file), contentType: MIME[extname(file).toLowerCase()] ?? 'application/octet-stream' });
}

/**
 * Launch headed Chrome, load `?render=offline&job=<jobUrl>&seed=<seed>` and wait for the app
 * to say it is ready. `serve(route, url)` answers the driver's own URLs (return undefined for
 * anything else; the built app answers those). Returns { browser, page, info, errors } with
 * info = { gpu, size, timeline, profile }.
 */
export async function openOfflinePage({ width, height, jobUrl, seed = 1, serve }) {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error(`no build at ${DIST}: run npm run build`);
  const vw = Math.min(width, 1600), vh = Math.min(height, 1000);
  const browser = await chromium.launch({ channel: 'chrome', headless: false,
    args: [`--use-angle=${process.env.ANGLE ?? 'gl'}`, '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling', `--window-size=${vw + 40},${vh + 160}`] });
  try {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
    await ctx.route(`${ORIGIN}/**`, (route) => {
      const url = new URL(route.request().url());
      const handled = serve?.(route, url);
      if (handled) return handled;
      return fulfillFile(route, join(DIST, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${ORIGIN}/?render=offline&job=${encodeURIComponent(jobUrl)}&seed=${seed}`);
    await page.waitForFunction(() => document.title === 'ready' || !!window.__ruttOfflineError, null, { timeout: 120000 })
      .catch(() => { throw new Error(`renderer never became ready: ${errors.slice(0, 5).join(' | ')}`); });
    const info = await page.evaluate(() => ({ gpu: window.__ruttOffline.gpu, size: window.__ruttOffline.size(),
      timeline: window.__ruttOffline.timeline, profile: window.__ruttOffline.profile ?? null }));
    if (SOFTWARE_GL.test(info.gpu)) throw new Error(`WebGL is on a software renderer (${info.gpu}); refusing to render`);
    if (info.size[0] !== width || info.size[1] !== height) throw new Error(`canvas is ${info.size.join('x')}, job wants ${width}x${height}`);
    return { browser, page, info, errors };
  } catch (e) {
    await browser.close();
    throw e;
  }
}
