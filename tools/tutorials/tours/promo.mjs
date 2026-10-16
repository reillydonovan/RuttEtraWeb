// The promo film (≈2:40) — "a 1973 instrument, rebuilt for the browser, by an AI".
//   node build.mjs --voice elevenlabs:<id> promo     → out/promo/promo.mp4 (+ promo-music.mp4)
//
// Not a lesson: build.mjs special-cases the id (no manifest, no About list).
// Every claim in the narration comes from the talk's own fact-checked material
// (ruttetraweb-presentation/FACT-CHECK.md): 1973; the beam is steered inside the
// tube; "approximately seventeen to twenty-one" built; the tube burned out and
// had to be replaced; nobody has counted the survivors (so none is claimed); the
// AI was pointed at the documentation and a person directed the decisions.
// Everything on screen is the real app (a real MCP connection, a real second app
// instance for the phone) — nothing is mocked up — and every state the
// narration describes is asserted with h.check / the harness guards.
import fs from 'node:fs';
import path from 'node:path';
import { bridgeServer } from '../lib/fakeio.mjs';
import { findJack } from '../lib/bay.mjs';

export const fakeMedia = true;
export const noCursor = true;        // a film, not a tutorial: no painted pointer
export const noCard = true;
export const music = true;           // also writes promo-music.mp4

const FACE = process.env.PROMO_FACE
  ?? path.resolve('..', '..', '..', 'ruttetraweb-presentation', 'media', 'demo', 'face.mp4');
const HAS_FACE = fs.existsSync(FACE);

let mcp = null;
export async function setup({ ctx }) {
  await ctx.grantPermissions(['microphone', 'camera']);
  mcp = bridgeServer(57132);
  return () => mcp.close();
}

export const lines = [
  { id: 'cold', text: 'In 1973, a small company in New York built a machine that could bend television.' },
  { id: 'name', text: 'It was called the Rutt Etra Scan Processor. It did not filter a picture. It reached inside the tube, and steered the beam.' },
  { id: 'height', text: 'Brighter became higher. Darker became lower. A flat image turned into a landscape, drawn in light.' },
  { id: 'few', text: 'Only about seventeen to twenty-one were ever built, and the tube inside each one burned out. When the hardware goes, the practice goes with it.' },
  { id: 'rebuilt', text: 'So it was rebuilt, from its own documentation. An AI was pointed at the archive: the brochure, the manual, the panel diagram. It read all of it, wrote a specification, and built the instrument against it. A person directed every decision.' },
  { id: 'web', text: 'It runs in a browser. Nothing to install. No waiting list. One link.' },
  { id: 'bay', text: 'The whole machine is laid out as a faceplate you can patch.' },
  { id: 'patch', text: 'Drag a cable from an oscillator into depth, and the picture breathes.' },
  { id: 'inputs', text: 'Audio, MIDI, gamepads, control voltage. Anything that moves can move the picture.' },
  { id: 'push', text: 'And then you push it. Two oscillators on the linearity, and the amount turned up. The raster pinches, folds, and flips over itself.' },
  { id: 'montage', text: 'A feedback tunnel. Two rasters woven line by line. Sound as terrain. Red and cyan in three dimensions.' },
  { id: 'mcp', text: 'It can be played by an AI, too. These are commands arriving over M C P, and this is the instrument answering.' },
  { id: 'phone', text: 'And it fits in a pocket: a camera, a shutter, and a look for every mood.' },
  { id: 'close', text: 'A machine that survived as documentation, rebuilt from that documentation, for the next generation of media artists. Rutt Etra web dot com.' },
];
export const poster = 'push';

const T = (k) => `#panel-root .rw-toggle[data-param-key="${k}"]`;
const K = (k) => `#panel-root [data-param-key="${k}"] .rw-knob`;

// ---- little on-screen furniture (the film's only non-app pixels: text) ----------
async function caption(page, kicker, title, ms = 3000) {
  await page.evaluate(([k, t, d]) => {
    const c = document.createElement('div');
    c.innerHTML = `<div style="font:600 13px ui-monospace,Menlo,Consolas,monospace;letter-spacing:.24em;text-transform:uppercase;color:#9bb">${k}</div>`
      + `<div style="font:700 44px -apple-system,'Segoe UI',system-ui,sans-serif;letter-spacing:-.02em;color:#fff;margin-top:6px">${t}</div>`;
    Object.assign(c.style, { position: 'fixed', left: '56px', bottom: '56px', zIndex: '2147483000', pointerEvents: 'none',
      padding: '18px 26px', borderRadius: '16px', background: 'rgba(0,0,0,.62)', backdropFilter: 'blur(14px)',
      border: '1px solid rgba(255,255,255,.12)', opacity: '0', transform: 'translateY(10px)', transition: 'opacity .6s ease, transform .6s ease' });
    document.documentElement.appendChild(c);
    requestAnimationFrame(() => { c.style.opacity = '1'; c.style.transform = 'none'; });
    setTimeout(() => { c.style.opacity = '0'; }, d);
    setTimeout(() => c.remove(), d + 800);
  }, [kicker, title, ms]);
}

async function logLine(page, html) {
  await page.evaluate((h) => {
    let t = document.getElementById('promo-term');
    if (!t) {
      t = document.createElement('div');
      t.id = 'promo-term';
      Object.assign(t.style, { position: 'fixed', right: '48px', bottom: '48px', width: '620px', maxHeight: '420px', overflow: 'hidden',
        zIndex: '2147483000', padding: '16px 20px', borderRadius: '14px', background: 'rgba(8,10,9,.86)', backdropFilter: 'blur(14px)',
        border: '1px solid rgba(95,255,133,.28)', font: '14px/1.55 ui-monospace,Menlo,Consolas,monospace', color: '#cfe', pointerEvents: 'none' });
      t.innerHTML = '<div style="color:#5fff85;letter-spacing:.2em;font-size:11px;margin-bottom:8px">MCP · AI ⇄ RUTT/ETRA WEB</div>';
      document.documentElement.appendChild(t);
    }
    const d = document.createElement('div');
    d.innerHTML = h;
    t.appendChild(d);
    while (t.childElementCount > 9) t.removeChild(t.children[1]);
  }, html);
}

async function mcpCall(page, h, cmd, args, note) {
  const argText = Object.entries(args).map(([k, v]) => `${k}: ${typeof v === 'object' ? '{…}' : JSON.stringify(v)}`).join(', ');
  await logLine(page, `<span style="color:#7dff9a">›</span> ${cmd}(${argText})${note ? ` <span style="color:#88a">— ${note}</span>` : ''}`);
  await h.wait(450);
  const r = await mcp.request(cmd, args);
  if (!r.ok) throw new Error(`MCP ${cmd}: ${r.error}`);
  await logLine(page, `<span style="color:#ffb347">‹</span> ok${typeof r.result === 'number' ? ` → ${r.result}` : ''}`);
  return r;
}

export async function pre(page, h) {
  // MCP stand-in connects quietly while the title screen is still up.
  await page.click('#rw-left-shell .rw-region-collapse-btn').catch(() => {});
  await page.click('#panel-root .rw-tab[data-tab="io"]').catch(() => {});
  await h.section('MCP');
  await page.click(`${await h.sec('MCP')} .rw-btn:text-is("Connect")`);
  for (let i = 0; i < 30 && !mcp.connected; i++) await h.wait(100);
  if (!mcp.connected) throw new Error('promo: the MCP stand-in never connected');
  await page.click('#panel-root .rw-tab[data-tab="synth"]');
  await page.click('#rw-left-shell .rw-region-collapse-btn').catch(() => {});   // restore
}

export async function run(page, seg, h) {
  // 1 — title screen, as it appears to a first-time visitor.
  await seg('cold', async () => { await h.wait(2000); });

  // 2 — start; the raster appears.
  await seg('name', async () => {
    await caption(page, '1973', 'Rutt/Etra Scan Processor', 4200);
    await h.click('#boot-pattern');
    await h.drag({ x: 900, y: 500 }, { x: 1100, y: 430 }, 70);
  });

  // 3 — brightness becomes height, on a face if we have one.
  await seg('height', async () => {
    if (HAS_FACE) {
      const chooser = page.waitForEvent('filechooser');
      await page.evaluate(() => document.getElementById('boot-file-input')?.click());
      await (await chooser).setFiles(FACE);
      await h.wait(1500);
    }
    await h.section('Display Control Unit');
    await h.reveal(K('zPush'), null, 'center');
    await h.knob(await h.at(K('zPush')), 70, 90);
    await h.drag({ x: 1000, y: 600 }, { x: 760, y: 480 }, 90);
  });

  await seg('few', async () => {
    await h.section('Color / Post FX');
    await h.choose(await h.at('#panel-root select[data-param-key="colorMode"]'), null, 'phosphorAmber');
    await h.drag({ x: 760, y: 480 }, { x: 1000, y: 560 }, 110);
    await caption(page, 'Rutt/Etra · built', 'about seventeen to twenty-one', 4200);
  });

  await seg('rebuilt', async () => {
    await h.choose(await h.at('#panel-root select[data-param-key="colorMode"]'), null, 'phosphorGreen');
    await caption(page, 'rebuilt from its own documentation', 'brochure · manual · panel diagram → specification → instrument', 7000);
    await h.drag({ x: 1000, y: 560 }, { x: 800, y: 470 }, 160);
  });

  await seg('web', async () => {
    await caption(page, 'nothing to install', 'ruttetraweb.com', 4200);
    await h.drag({ x: 800, y: 470 }, { x: 1000, y: 520 }, 100);
  });

  await seg('bay', async () => {
    await h.click('#rw-left-shell .rw-region-max-btn');
    await h.wait(500);
    for (const b of ['SINE', 'SAW', 'AUDIO ENV', 'BEAT', 'MIDI CC']) {
      const j = await page.evaluate(findJack, { bus: b });
      if (j) { await h.glide(j, 14); await h.wait(220); }
    }
  });

  await seg('patch', async () => {
    await h.click(await h.emptyBaySpot(), null, { button: 'right' });
    await h.wait(600);
    await h.click('.rw-pb-addnode-menu .rw-graph-palette-item', 'LFO', { exact: true, steps: 25 });
    await h.wait(500);
    const out = await h.at('.rw-pb-graphnode .rw-rack-jack--out');
    await h.dragPan(out, { x: 700, y: 66 }, findJack, { param: 'Z Push', margin: 60 });
    await h.check(() => [...document.querySelectorAll('.rw-patchbay .rw-pb-cell-top')]
      .find((c) => c.textContent.trim().startsWith('Z Push') && !c.closest('.rw-pb-module'))
      ?.querySelector('.rw-rack-jack--in')?.classList.contains('rw-rack-jack--plugged'), 'Z Push is patched from the LFO');
    await h.click('#rw-left-shell .rw-region-max-btn');
    await h.wait(2800);
  });

  await seg('inputs', async () => {
    await h.click('#rw-left-shell .rw-region-max-btn');
    await h.wait(500);
    for (const b of ['AUDIO BAND', 'JOY X', 'CV IN', 'OSC']) {
      const j = await page.evaluate(findJack, { bus: b, margin: 0 });
      if (j) { await h.glide(j, 14); await h.wait(300); }
    }
    await h.click('#rw-left-shell .rw-region-max-btn');
  });

  await seg('push', async () => {
    await h.section('Modulation');
    await h.click('#panel-root .rw-mod-mode-switch button[data-mode="graph"]');
    await h.wait(900);
    const last = '#panel-root .rw-beginner-view .rw-mod-slot:last-of-type';
    // The LFO from the Patch Bay is already row one; add two more for linearity.
    for (const target of ['hLinearity', 'vLinearity']) {
      await h.click('#panel-root .rw-beginner-view .rw-btn', 'Add patch');
      await h.wait(500);
      await h.choose(await h.at(`${last} select.rw-mod-slot-tgt`), null, target);
      await h.check((t) => document.querySelector('#panel-root .rw-beginner-view .rw-mod-slot:last-of-type select.rw-mod-slot-tgt')?.value === t, `target ${target}`, target);
    }
    const rows = await page.evaluate(() => document.querySelectorAll('#panel-root .rw-beginner-view .rw-mod-slot').length);
    const amt = (i) => `#panel-root .rw-beginner-view .rw-mod-slot:nth-of-type(${i}) .rw-mod-slot-amount .rw-knob`;
    for (let i = 0; i < 4; i++) {
      await h.knob(await h.at(amt(rows - 1)), 22, 40);
      await h.knob(await h.at(amt(rows)), 22, 40);
      await h.wait(1300);
    }
    await h.drag({ x: 900, y: 520 }, { x: 1080, y: 430 }, 120);
    await h.wait(1200);
  });

  await seg('montage', async () => {
    // Clear the linearity patch so each look is itself.
    await mcp.request('set_graph_patch', { patch: null });
    await h.resetView();
    await h.section('Color / Post FX');
    await h.choose(await h.at('#panel-root select[data-param-key="colorMode"]'), null, 'phosphorAmber');
    await h.click(T('feedbackEnabled'));
    await h.choose(await h.at('#panel-root select[data-param-key="feedbackShape"]'), null, 'circle');
    await h.wait(2500);
    await h.click(T('feedbackEnabled'));
    await h.choose(await h.at('#panel-root select[data-param-key="colorMode"]'), null, 'phosphorGreen');
    await h.section('Dual Raster');
    await h.click(T('dualRasterEnabled'));
    await h.choose(await h.at('#panel-root select[data-param-key="dualMode"]'), null, 'alternate');
    await h.knob(await h.at(K('bZPush')), -50, 30);
    await h.drag({ x: 860, y: 450 }, { x: 1080, y: 380 }, 70);
    await h.click(T('dualRasterEnabled'));
    await h.section('Presets');
    await h.click('#panel-root .rw-preset-chip', 'Lissajous Scope', { exact: true });
    await h.section('Virtual Camera');
    await h.click(T('anaglyphEnabled'));
    await h.wait(2000);
  });

  await seg('mcp', async () => {
    await h.click(T('anaglyphEnabled'));
    await h.click('#panel-root .rw-preset-chip', 'Classic 1974', { exact: true });
    await h.wait(600);
    await mcpCall(page, h, 'describe', {}, 'what can I drive?');
    await mcpCall(page, h, 'set_param', { key: 'zPush', value: 2.2 }, 'depth');
    await mcpCall(page, h, 'set_param', { key: 'rotation', value: 0.35 }, 'rotate the raster');
    await mcpCall(page, h, 'set_param', { key: 'bloomIntensity', value: 0.9 }, 'glow');
    await mcpCall(page, h, 'set_graph_patch', { patch: {
      nodes: [{ id: 'l1', type: 'lfo', params: { rate: 0.4 }, inputs: {} }],
      bindings: [{ id: 'b1', paramKey: 'hLinearity', sourceNodeId: 'l1', amount: 0.9, mode: 'additive', enabled: true }],
    } }, 'patch an LFO into H Linearity');
    await h.wait(1800);
    await page.evaluate(() => document.getElementById('promo-term')?.remove());
  });

  // The phone: a SECOND, real instance of the app in compact (phone) layout.
  await seg('phone', async () => {
    await mcp.request('set_graph_patch', { patch: null });
    await page.evaluate(() => {
      const wrap = document.createElement('div');
      wrap.id = 'promo-phone';
      Object.assign(wrap.style, { position: 'fixed', right: '90px', top: '70px', width: '390px', height: '800px', zIndex: '2147483000',
        borderRadius: '46px', border: '10px solid #0b0b0c', boxShadow: '0 30px 90px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.12)', overflow: 'hidden', background: '#000' });
      const f = document.createElement('iframe');
      f.src = `${location.origin}${location.pathname}?layout=compact`;
      f.allow = 'camera; microphone';
      Object.assign(f.style, { width: '100%', height: '100%', border: '0' });
      wrap.appendChild(f);
      document.documentElement.appendChild(wrap);
    });
    let frame = null;
    for (let i = 0; i < 100 && !frame; i++) { frame = page.frames().find((f) => f.url().includes('layout=compact')) ?? null; if (!frame) await h.wait(100); }
    if (!frame) throw new Error('promo: the phone frame never loaded');
    await frame.waitForSelector('#boot-webcam', { timeout: 20000 });
    await h.wait(900);
    await frame.evaluate(() => document.getElementById('boot-webcam').click());
    await frame.waitForSelector('.rw-looks', { timeout: 20000 });
    await h.wait(1200);
    for (const name of ['Amber Terminal', 'Wireframe', 'Burn-In']) {
      await frame.evaluate((n) => [...document.querySelectorAll('.rw-look')].find((b) => b.textContent === n)?.click(), name);
      await h.wait(1500);
    }
    await frame.evaluate(() => document.querySelector('.rw-shutter')?.click());
    await h.wait(900);
  });

  await seg('close', async () => {
    await page.evaluate(() => document.getElementById('promo-phone')?.remove());
    await h.resetView();
    await caption(page, 'rutt/etra web', 'ruttetraweb.com', 9000);
    await h.drag({ x: 880, y: 450 }, { x: 1080, y: 400 }, 200);
    await h.wait(2500);
  });
}
