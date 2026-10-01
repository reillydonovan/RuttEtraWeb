// Advanced — I/O: CV inputs, OSC CV, gamepads, and MCP (AI remote control).
// Chrome's fake microphone stands in for an audio interface; a local
// WebSocket server plays the MCP bridge and sends real commands.
import { bootPattern } from '../lib/helpers.mjs';
import { bridgeServer } from '../lib/fakeio.mjs';

export const fakeMedia = true;
let mcp = null;
export async function setup({ ctx }) {
  await ctx.grantPermissions(['microphone', 'camera']);
  mcp = bridgeServer(57132);
  return () => mcp.close();
}

export const lines = [
  { id: 'intro', text: 'Control voltage connects modular synthesizers. Through a DC-coupled audio interface, each input channel becomes a modulation source.' },
  { id: 'start', text: 'Pick the interface, choose how many channels, and start the CV reader. A test signal stands in for a real interface here.' },
  { id: 'channel', text: 'Each channel shows its live voltage. Set its range, plus or minus five volts for Eurorack, its polarity and smoothing, and Calibrate to zero it.' },
  { id: 'osccv', text: 'No interface? A Raspberry Pi with an analog to digital converter can send CV as OSC instead. Add an OSC CV channel and give it an address.' },
  { id: 'gamepad', text: 'Gamepads and HID controllers appear here, too. Every axis and button becomes a source.' },
  { id: 'mcp', text: 'MCP lets an AI assistant, like Claude, drive the synth through the bridge in the tools folder. Connect to the bridge.' },
  { id: 'drive', text: 'Now the assistant is in control. It deepens the raster, widens it, turns it, and then builds a modulation patch from scratch.' },
  { id: 'outro', text: 'Anything an assistant can set, it can also read back: parameters, patches, even a screenshot. Next: the outputs.' },
];
export const poster = 'drive';

export async function pre(page) { await bootPattern(page); }

export async function run(page, seg, h) {
  await seg('intro', async () => {
    await h.wait(2600);
    await h.click('#panel-root .rw-tab[data-tab="io"]');
    await h.section('CV');
  });

  await seg('start', async () => {
    const S = await h.sec('CV');
    const sel = await h.row('Interface', 'select', S);
    const val = await page.evaluate((s) => {
      const r = [...document.querySelectorAll(`${s} .rw-row`)].find((e) => e.querySelector('.rw-label')?.textContent.trim() === 'Interface');
      const o = [...r.querySelector('select').options].find((x) => x.value);
      return o?.value ?? null;
    }, S);
    if (!val) throw new Error('no CV interface listed');
    await h.choose(sel, null, val);
    await h.click(await h.row('Request channels', 'input', S));
    await page.keyboard.press('Control+A');
    await page.keyboard.type('1', { delay: 100 });
    await page.keyboard.press('Tab');
    await h.click(`${S} .rw-btn`, 'Start CV input', { exact: true });
    await h.check((s) => /Running/.test(document.querySelector(s)?.textContent ?? ''), 'CV running', S);
  });

  await seg('channel', async () => {
    const S = await h.sec('CV');
    for (const l of ['Range', 'Polarity', 'Smooth (ms)']) {
      await h.glide(await h.row(l, 'select, input', S).catch(() => ({ x: 1740, y: 500 })), 18);
      await h.wait(450);
    }
    await h.glide(await h.at(`${S} .rw-btn`, 'Calibrate'), 18);
  });

  await seg('osccv', async () => {
    const S = await h.sec('CV');
    await h.click(`${S} .rw-btn`, 'Add OSC CV channel');
    await h.wait(600);
  });

  await seg('gamepad', async () => {
    const S = await h.sec('CV');
    await h.glide(await h.text(S, 'Gamepad / HID'), 25);
    await h.wait(400);
    await h.glide(await h.text(S, 'Gamepad'), 25);
  });

  await seg('mcp', async () => {
    await h.section('MCP');
    const S = await h.sec('MCP');
    await h.click(`${S} .rw-btn`, 'Connect', { exact: true });
    for (let i = 0; i < 30 && !mcp.connected; i++) await h.wait(100);
    if (!mcp.connected) throw new Error('MCP bridge stand-in never connected');
    await h.wait(600);
  });

  await seg('drive', async () => {
    await h.glide({ x: 980, y: 450 }, 40);
    const steps = [['zPush', 2.6], ['hSize', 1.5], ['rotation', 30]];
    for (const [key, value] of steps) {
      const r = await mcp.request('set_param', { key, value });
      if (!r.ok) throw new Error(`MCP set_param ${key}: ${r.error}`);
      await h.wait(1300);
    }
    const r = await mcp.request('set_graph_patch', { patch: {
      nodes: [{ id: 'mcp-lfo', type: 'lfo', params: { rate: 0.4, shape: 'triangle' }, inputs: {} }],
      bindings: [{ id: 'mcp-b', paramKey: 'vSize', sourceNodeId: 'mcp-lfo', amount: 0.8, mode: 'additive', enabled: true }],
    } });
    if (!r.ok) throw new Error(`MCP set_graph_patch: ${r.error}`);
    await h.wait(2500);
  });

  await seg('outro', async () => { await h.drag({ x: 880, y: 450 }, { x: 1080, y: 380 }, 90); });
}
