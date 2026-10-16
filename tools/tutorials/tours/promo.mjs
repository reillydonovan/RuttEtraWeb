// The promo film (≈2:30) — "a 1973 instrument, rebuilt for the browser, by an AI".
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
// Desktop Chrome would open the OS share dialog from the phone's shutter.
export const initScripts = ['Object.defineProperty(Navigator.prototype, "canShare", { value: undefined, configurable: true });'];

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
  { id: 'montage', text: 'A feedback tunnel. Two rasters woven line by line. Red and cyan, in three dimensions.' },
  { id: 'mcp', text: 'It can be played by an AI, too. These are commands arriving over M C P, and this is the instrument answering.' },
  { id: 'phone', text: 'And it fits in a pocket: a camera, a shutter, and a look for every mood.' },
  { id: 'close', text: 'A machine that survived as documentation, rebuilt from that documentation, for the next generation of media artists. Rutt Etra web dot com.' },
];
export const poster = 'push';

// ---- on-screen furniture: text only; everything else is the real app -------------
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
      Object.assign(t.style, { position: 'fixed', right: '48px', bottom: '48px', width: '820px', maxHeight: '560px', overflow: 'hidden',
        zIndex: '2147483000', padding: '16px 20px', borderRadius: '14px', background: 'rgba(8,10,9,.86)', backdropFilter: 'blur(14px)',
        border: '1px solid rgba(95,255,133,.28)', font: '19px/1.6 ui-monospace,Menlo,Consolas,monospace', color: '#cfe', pointerEvents: 'none' });
      t.innerHTML = '<div style="color:#5fff85;letter-spacing:.2em;font-size:13px;margin-bottom:10px">MCP · AI ⇄ RUTT/ETRA WEB</div>';
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
  await h.wait(350);
  const r = await mcp.request(cmd, args);
  if (!r.ok) throw new Error(`MCP ${cmd}: ${r.error}`);
  await logLine(page, `<span style="color:#ffb347">‹</span> ok${typeof r.result === 'number' ? ` → ${r.result}` : ''}`);
  return r;
}

/** The picture full-bleed (every other window hidden) or the whole workspace. */
async function maxCenter(page, h, on) {
  const now = await page.evaluate(() => document.body.classList.contains('rw-center-max'));
  if (now !== on) { await h.click('#rw-center-shell .rw-region-max-btn', null, { steps: 14, pause: 120 }); await h.wait(500); }
  await h.check((o) => document.body.classList.contains('rw-center-max') === o, `center ${on ? 'maximized' : 'restored'}`, on);
}

// Quiet control: sets a Controls value without the panel on screen (the panel is hidden
// while the picture is full-bleed). It raises the same events a click would.
const quiet = {
  select: (page, key, value) => page.evaluate(([k, v]) => {
    const s = document.querySelector(`#panel-root select[data-param-key="${k}"]`);
    if (!s) throw new Error(`no select ${k}`);
    s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true }));
  }, [key, value]),
  toggle: (page, key) => page.evaluate((k) => {
    const i = document.querySelector(`#panel-root .rw-toggle[data-param-key="${k}"] input`);
    if (!i) throw new Error(`no toggle ${k}`);
    i.click();
  }, key),
  /** Glide a range from its current value to `to` over `ms` (it moves like a hand on a knob). */
  async ramp(page, h, key, to, ms = 2200) {
    const from = await page.evaluate((k) => +document.querySelector(`#panel-root [data-param-key="${k}"] input[type=range]`).value, key);
    const n = Math.max(2, Math.round(ms / 70));
    for (let i = 1; i <= n; i++) {
      const v = from + (to - from) * (i / n);
      await page.evaluate(([k, val]) => { const r = document.querySelector(`#panel-root [data-param-key="${k}"] input[type=range]`); r.value = String(val); r.dispatchEvent(new Event('input', { bubbles: true })); }, [key, v]);
      await h.wait(70);
    }
  },
  chip: (page, name) => page.evaluate((n) => [...document.querySelectorAll('#panel-root .rw-preset-chip')].find((c) => c.textContent.trim() === n)?.click(), name),
};

export async function pre(page, h) {
  // The MCP stand-in connects quietly while the title screen is still up.
  await page.click('#panel-root .rw-tab[data-tab="io"]').catch(() => {});
  await h.section('MCP');
  await page.click(`${await h.sec('MCP')} .rw-btn:text-is("Connect")`);
  for (let i = 0; i < 30 && !mcp.connected; i++) await h.wait(100);
  if (!mcp.connected) throw new Error('promo: the MCP stand-in never connected');
  await page.click('#panel-root .rw-tab[data-tab="synth"]');
  await maxCenter(page, h, true);
}

export async function run(page, seg, h) {
  // 1 — the title screen, full-bleed, as a first-time visitor sees it.
  await seg('cold', async () => { await h.wait(2200); });

  // 2 — start; the raster appears and turns slowly.
  await seg('name', async () => {
    await caption(page, '1973', 'Rutt/Etra Scan Processor', 4200);
    await h.click('#boot-pattern', null, { steps: 14, pause: 200 });
    await h.drag({ x: 900, y: 500 }, { x: 1100, y: 430 }, 90);
  });

  // 3 — brightness becomes height (on a face, if one was supplied).
  await seg('height', async () => {
    if (HAS_FACE) {
      const chooser = page.waitForEvent('filechooser');
      await page.evaluate(() => document.getElementById('boot-file-input')?.click());
      await (await chooser).setFiles(FACE);
      await h.wait(1500);
    }
    await quiet.ramp(page, h, 'zPush', 2.2, 2600);
    await h.drag({ x: 1000, y: 600 }, { x: 760, y: 480 }, 100);
  });

  await seg('few', async () => {
    await quiet.select(page, 'colorMode', 'phosphorAmber');
    await caption(page, 'Rutt/Etra · built', 'about seventeen to twenty-one', 4200);
    await h.drag({ x: 760, y: 480 }, { x: 1000, y: 560 }, 130);
  });

  await seg('rebuilt', async () => {
    await quiet.select(page, 'colorMode', 'phosphorGreen');
    await caption(page, 'rebuilt from its own documentation', 'brochure · manual · panel diagram → specification → instrument', 7500);
    await h.drag({ x: 1000, y: 560 }, { x: 800, y: 470 }, 200);
  });

  await seg('web', async () => {
    await caption(page, 'nothing to install', 'ruttetraweb.com', 4200);
    await h.drag({ x: 800, y: 470 }, { x: 1000, y: 520 }, 120);
  });

  // 4 — the instrument as a faceplate: the real Patch Bay.
  await seg('bay', async () => {
    await maxCenter(page, h, false);
    await h.click('#rw-left-shell .rw-region-max-btn', null, { steps: 14, pause: 120 });
    await h.wait(400);
    for (const b of ['SINE', 'SAW', 'AUDIO ENV', 'BEAT', 'MIDI CC']) {
      const j = await page.evaluate(findJack, { bus: b });
      if (j) { await h.glide(j, 12); await h.wait(160); }
    }
  });

  await seg('patch', async () => {
    await h.click(await h.emptyBaySpot(), null, { button: 'right', steps: 14, pause: 120 });
    await h.wait(500);
    await h.click('.rw-pb-addnode-menu .rw-graph-palette-item', 'LFO', { exact: true, steps: 18 });
    await h.wait(400);
    const out = await h.at('.rw-pb-graphnode .rw-rack-jack--out');
    await h.dragPan(out, { x: 700, y: 66 }, findJack, { param: 'Z Push', margin: 60 });
    await h.check(() => [...document.querySelectorAll('.rw-patchbay .rw-pb-cell-top')]
      .find((c) => c.textContent.trim().startsWith('Z Push') && !c.closest('.rw-pb-module'))
      ?.querySelector('.rw-rack-jack--in')?.classList.contains('rw-rack-jack--plugged'), 'Z Push is patched from the LFO');
    await h.click('#rw-left-shell .rw-region-max-btn', null, { steps: 14, pause: 120 });
    await h.wait(1800);
  });

  await seg('inputs', async () => {
    await h.click('#rw-left-shell .rw-region-max-btn', null, { steps: 14, pause: 120 });
    await h.wait(400);
    for (const b of ['AUDIO BAND', 'JOY X', 'CV IN', 'OSC']) {
      const j = await page.evaluate(findJack, { bus: b, margin: 0 });
      if (j) { await h.glide(j, 12); await h.wait(220); }
    }
    await h.click('#rw-left-shell .rw-region-max-btn', null, { steps: 14, pause: 120 });
  });

  // 5 — push it: two LFOs on the linearity, the amount turned up. Real knobs, real panel.
  await seg('push', async () => {
    await h.section('Modulation');
    await h.click('#panel-root .rw-mod-mode-switch button[data-mode="graph"]', null, { steps: 12, pause: 80 });
    await h.wait(500);
    const last = '#panel-root .rw-beginner-view .rw-mod-slot:last-of-type';
    for (const target of ['hLinearity', 'vLinearity']) {
      await h.click('#panel-root .rw-beginner-view .rw-btn', 'Add patch', { steps: 12, pause: 80 });
      await h.wait(350);
      await h.choose(await h.at(`${last} select.rw-mod-slot-tgt`), null, target);
      await h.check((t) => document.querySelector('#panel-root .rw-beginner-view .rw-mod-slot:last-of-type select.rw-mod-slot-tgt')?.value === t, `target ${target}`, target);
    }
    const rows = await page.evaluate(() => document.querySelectorAll('#panel-root .rw-beginner-view .rw-mod-slot').length);
    const amt = (i) => `#panel-root .rw-beginner-view .rw-mod-slot:nth-of-type(${i}) .rw-mod-slot-amount .rw-knob`;
    for (let i = 0; i < 3; i++) {
      await h.knob(await h.at(amt(rows - 1)), 24, 30);
      await h.knob(await h.at(amt(rows)), 24, 30);
      await h.wait(900);
    }
    await maxCenter(page, h, true);
    await h.drag({ x: 900, y: 520 }, { x: 1080, y: 430 }, 130);
    await h.wait(1500);
  });

  // 6 — a few strange looks, full-bleed.
  await seg('montage', async () => {
    await mcp.request('set_graph_patch', { patch: null });
    await h.resetView();
    await quiet.select(page, 'colorMode', 'phosphorAmber');
    await quiet.toggle(page, 'feedbackEnabled');
    await quiet.select(page, 'feedbackShape', 'circle');
    await h.drag({ x: 880, y: 500 }, { x: 1040, y: 440 }, 110);
    await quiet.toggle(page, 'feedbackEnabled');
    await quiet.select(page, 'colorMode', 'phosphorGreen');
    await quiet.toggle(page, 'dualRasterEnabled');
    await quiet.select(page, 'dualMode', 'alternate');
    await quiet.ramp(page, h, 'bZPush', -0.8, 900);
    await h.drag({ x: 860, y: 450 }, { x: 1080, y: 380 }, 110);
    await quiet.toggle(page, 'dualRasterEnabled');
    await quiet.toggle(page, 'anaglyphEnabled');
    await h.drag({ x: 900, y: 470 }, { x: 1060, y: 420 }, 110);
    await h.wait(900);
  });

  // 7 — an AI at the controls, over MCP (a real connection; the log is its real traffic).
  await seg('mcp', async () => {
    await quiet.toggle(page, 'anaglyphEnabled');
    await quiet.chip(page, 'Phosphor Green');
    await mcp.request('set_param', { key: 'bloomIntensity', value: 0.35 });
    await mcp.request('set_param', { key: 'zPush', value: 1.2 });
    await h.wait(500);
    await mcpCall(page, h, 'describe', {}, 'what can I drive?');
    await mcpCall(page, h, 'set_param', { key: 'zPush', value: 1.8 }, 'depth');
    await mcpCall(page, h, 'set_param', { key: 'rotation', value: 0.35 }, 'rotate the raster');
    await mcpCall(page, h, 'set_graph_patch', { patch: {
      nodes: [{ id: 'l1', type: 'lfo', params: { rate: 0.4 }, inputs: {} }],
      bindings: [{ id: 'b1', paramKey: 'hLinearity', sourceNodeId: 'l1', amount: 0.9, mode: 'additive', enabled: true }],
    } }, 'patch an LFO into H Linearity');
    await h.wait(1500);
    await page.evaluate(() => document.getElementById('promo-term')?.remove());
  });

  // 8 — the phone: a SECOND, real instance of the app in its phone layout.
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
    await frame.waitForSelector('#boot-pattern', { timeout: 20000 });
    await h.wait(600);
    await frame.evaluate(() => document.getElementById('boot-pattern').click());
    await frame.waitForSelector('.rw-looks', { timeout: 20000 });
    await h.wait(900);
    for (const name of ['Amber Terminal', 'Wireframe', 'Burn-In']) {
      await frame.evaluate((n) => [...document.querySelectorAll('.rw-look')].find((b) => b.textContent === n)?.click(), name);
      await frame.waitForFunction((n) => document.querySelector('.rw-look.active')?.textContent === n, name, { timeout: 5000 });
      await h.wait(1300);
    }
    await frame.evaluate(() => document.querySelector('.rw-shutter')?.click());
    await frame.waitForFunction(() => /Photo saved/.test(document.querySelector('#rw-toast-host')?.textContent ?? ''), null, { timeout: 8000 });
    await h.wait(600);
  });

  await seg('close', async () => {
    await page.evaluate(() => document.getElementById('promo-phone')?.remove());
    await h.resetView();
    // Leave the camera moving in the wildest state the instrument has: two oscillators on the
    // linearity (the same patch the 'push' beat built by hand, here set over MCP).
    await mcp.request('set_graph_patch', { patch: {
      nodes: [{ id: 'a', type: 'lfo', params: { rate: 0.31 }, inputs: {} }, { id: 'b', type: 'lfo', params: { rate: 0.23 }, inputs: {} }],
      bindings: [
        { id: 'b1', paramKey: 'hLinearity', sourceNodeId: 'a', amount: 0.85, mode: 'additive', enabled: true },
        { id: 'b2', paramKey: 'vLinearity', sourceNodeId: 'b', amount: 0.85, mode: 'additive', enabled: true },
      ],
    } });
    await caption(page, 'rutt/etra web', 'ruttetraweb.com', 7000);
    await h.drag({ x: 880, y: 450 }, { x: 1080, y: 400 }, 160);
    await h.wait(1200);
  });
}
