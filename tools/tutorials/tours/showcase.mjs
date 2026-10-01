// Advanced — showcase: five strange setups built from everything in the course.
import { bridgeServer } from '../lib/fakeio.mjs';

export const fakeMedia = true;
let mcp = null;
export async function setup({ ctx }) {
  await ctx.grantPermissions(['microphone', 'camera']);
  mcp = bridgeServer(57132);
  return () => mcp.close();
}

export const lines = [
  { id: 'intro', text: "To finish, five setups built from everything in this course. None of them took more than a minute. Let's get weird." },
  { id: 'tunnel', text: 'One. A feedback tunnel. The camera, amber phosphor, circular burn-in with a long decay, and the camera slowly orbiting.' },
  { id: 'tunnel2', text: 'Every frame smears into the next, so the picture leaves a trail of itself.' },
  { id: 'worlds', text: 'Two. Interleaved worlds. Dual Raster, alternate lines, with raster B pushed the opposite way and turned. Two copies of the same camera, woven together. One pushes toward you, the other falls away, and every other scan line flips between them, so the picture seems to argue with itself. Orbit around it, and the two layers slide apart.' },
  { id: 'chaos', text: 'Three. Resonant chaos, loaded from a saved patch: filtered noise wobbling the rotation, and a feedback loop chasing the depth. Wireframe mode makes it a sculpture.' },
  { id: 'sound', text: 'Four. Sound terrain. The microphone drives spectrum displacement, so every frequency band lifts its own scan lines. Magenta, with heavy bloom.' },
  { id: 'scope', text: 'Five. A Lissajous figure, in red and cyan anaglyph, drifting in 3D. Put on the glasses.' },
  { id: 'outro', text: "That's the instrument. Now go make something nobody has seen before." },
];
export const poster = 'worlds';

const T = (k) => `#panel-root .rw-toggle[data-param-key="${k}"]`;
const K = (k) => `#panel-root [data-param-key="${k}"] .rw-knob`;

export async function pre(page, h) {
  await page.click('#boot-webcam');
  await page.waitForTimeout(2000);
  // Connect the MCP stand-in quietly, so a saved patch can be loaded instantly later.
  await page.click('#panel-root .rw-tab[data-tab="io"]');
  await h.section('MCP');
  await page.click(`${await h.sec('MCP')} .rw-btn:text-is("Connect")`);
  for (let i = 0; i < 30 && !mcp.connected; i++) await h.wait(100);
  await page.click('#panel-root .rw-tab[data-tab="synth"]');
}

export async function run(page, seg, h) {
  await seg('intro', async () => { await h.wait(2600); await h.drag({ x: 880, y: 450 }, { x: 1060, y: 400 }, 80); });

  await seg('tunnel', async () => {
    await h.section('Color / Post FX');
    await h.choose(await h.at('#panel-root select[data-param-key="colorMode"]'), null, 'phosphorAmber');
    await h.click(T('feedbackEnabled'));
    await h.choose(await h.at('#panel-root select[data-param-key="feedbackShape"]'), null, 'circle');
    await h.knob(await h.at(K('feedbackDecay')), 60, 30);
    await h.section('Virtual Camera');
    await h.click(T('autoOrbit'));
    await h.knob(await h.at(K('autoOrbitSpeed')), 20, 20);
  });

  await seg('tunnel2', async () => { await h.glide({ x: 980, y: 450 }, 40); await h.wait(2000); });

  await seg('worlds', async () => {
    await h.click(T('autoOrbit'));
    await h.check(() => !document.querySelector('#panel-root .rw-toggle[data-param-key="autoOrbit"] input')?.checked, 'auto-orbit off');
    await h.resetView();
    await h.section('Color / Post FX', { scrollOnly: true });
    await h.click(T('feedbackEnabled'));
    await h.choose(await h.at('#panel-root select[data-param-key="colorMode"]'), null, 'phosphorGreen');
    await h.section('Dual Raster');
    await h.click(T('dualRasterEnabled'));
    await h.choose(await h.at('#panel-root select[data-param-key="dualMode"]'), null, 'alternate');
    await h.knob(await h.at(K('bZPush')), -50, 30);
    await h.knob(await h.at(K('bRotation')), 18, 30);
    await h.drag({ x: 860, y: 450 }, { x: 1080, y: 380 }, 70);
  });

  await seg('chaos', async () => {
    await h.resetView();
    await h.click(T('dualRasterEnabled'));
    const r = await mcp.request('set_graph_patch', { patch: {
      nodes: [
        { id: 'nz', type: 'noise', params: {}, inputs: {} },
        { id: 'flt', type: 'filter', params: { cutoffHz: 0.45, resonance: 0.92 }, inputs: { in: 'nz' } },
        { id: 'po', type: 'param-out', params: { key: 'zPush' }, inputs: {} },
        { id: 'dl', type: 'delay', params: { frames: 24 }, inputs: { in: 'po' } },
        { id: 'sc', type: 'scale', params: { factor: 1.3 }, inputs: { in: 'dl' } },
      ],
      bindings: [
        { id: 'b1', paramKey: 'rotation', sourceNodeId: 'flt', amount: 18, mode: 'additive', enabled: true },
        { id: 'b2', paramKey: 'hPos', sourceNodeId: 'flt', amount: 0.5, mode: 'additive', enabled: true },
        { id: 'b3', paramKey: 'zPush', sourceNodeId: 'sc', amount: 0.6, mode: 'additive', enabled: true },
        { id: 'b4', paramKey: 'zPush', sourceNodeId: 'flt', amount: 0.9, mode: 'additive', enabled: true },
      ],
    } });
    if (!r.ok) throw new Error(`chaos patch: ${r.error}`);
    await h.section('Geometry');
    await h.choose(await h.at('#panel-root select[data-param-key="renderMode"]'), null, 'wireframe');
    await h.glide({ x: 980, y: 450 }, 40);
    await h.wait(2500);
  });

  await seg('sound', async () => {
    await h.resetView();
    await mcp.request('set_graph_patch', { patch: null });
    await h.choose(await h.at('#panel-root select[data-param-key="renderMode"]'), null, 'scanlines');
    await h.click('#panel-root .rw-tab[data-tab="io"]');
    await h.section('Audio');
    const S = await h.sec('Audio');
    await h.choose(await h.row('Source', 'select', S), null, 'mic');
    await h.choose(await h.row('Spacing', 'select', S), null, 'linear');
    const G = await h.grp('Spectrum -> Z displacement');
    await h.click(await h.row('Enable', '.rw-toggle', G));
    await h.knob(await h.row('Amount', '.rw-knob', G), 70, 30);
    await h.click('#panel-root .rw-tab[data-tab="synth"]');
    await h.section('Color / Post FX');
    await h.choose(await h.at('#panel-root select[data-param-key="colorMode"]'), null, 'phosphorCustom');
    await page.evaluate(() => {
      const i = document.querySelector('#panel-root input[type=color][data-param-key="customTint"]');
      i.value = '#ff3cf0';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await h.knob(await h.at(K('bloomIntensity')), 70, 30);
    await h.glide({ x: 980, y: 450 }, 40);
  });

  await seg('scope', async () => {
    await h.resetView();
    await h.section('Presets');
    await h.click('#panel-root .rw-preset-chip', 'Lissajous Scope', { exact: true });
    await h.section('Virtual Camera');
    await h.click(T('anaglyphEnabled'));
    await h.click(T('autoOrbit'));
    await h.glide({ x: 980, y: 450 }, 40);
    await h.wait(2500);
  });

  await seg('outro', async () => { await h.drag({ x: 880, y: 450 }, { x: 1060, y: 380 }, 90); });
}
