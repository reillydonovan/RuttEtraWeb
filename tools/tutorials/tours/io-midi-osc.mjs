// Advanced — I/O: MIDI (connect, learn, clock) and OSC (bridge, learn).
// No hardware: a fake MIDI controller is injected into the page, and a
// local WebSocket server stands in for the OSC bridge.
import { bootPattern } from '../lib/helpers.mjs';
import { FAKE_MIDI_SCRIPT, bridgeServer } from '../lib/fakeio.mjs';

export const initScripts = [FAKE_MIDI_SCRIPT];
const OSC_PORT = 8765;
let osc = null;
export async function setup() {
  osc = bridgeServer(OSC_PORT);
  return () => osc.close();
}

export const lines = [
  { id: 'intro', text: 'The I O tab connects the synth to the outside world. First, MIDI. Click Connect MIDI, and pick your controller.' },
  { id: 'learn', text: 'To map a knob, choose a target, click Learn, then move the control. Here, Z Push.' },
  { id: 'play', text: 'Now the controller plays the depth directly. Each binding has its own curve and range.' },
  { id: 'clock', text: 'MIDI clock in sets the tempo from a drum machine or a DAW. The readout shows the incoming BPM. Clock Out sends the tempo the other way.' },
  { id: 'osc', text: 'OSC works over the network, from TouchOSC, Max, or SuperCollider, through the small bridge in the tools folder. Enter the bridge address and connect.' },
  { id: 'osclearn', text: 'Learn works the same way: choose H Size, click Learn, and send a message.' },
  { id: 'oscplay', text: 'Every OSC message on that address now moves the parameter. Copy TouchOSC layout gives you a ready-made control surface.' },
  { id: 'outro', text: 'MIDI and OSC sources also exist as graph nodes, for patching instead of mapping. Next: control voltage, gamepads and MCP.' },
];
export const poster = 'play';

export async function pre(page) { await bootPattern(page); }

async function learn(page, h, S, target) {
  const sel = await h.at(`${S} .rw-learn-add select.rw-select`);
  await h.choose(sel, null, target);
  await h.click(`${S} .rw-learn-add .rw-btn`, 'Learn');
}

export async function run(page, seg, h) {
  await seg('intro', async () => {
    await h.wait(2600);
    await h.click('#panel-root .rw-tab[data-tab="io"]');
    await h.section('MIDI');
    const S = await h.sec('MIDI');
    await h.click(`${S} .rw-btn`, 'Connect MIDI', { exact: true });
    await h.wait(600);
    await h.choose(await h.row('Input', 'select', S), null, 'tut-in');
  });

  await seg('learn', async () => {
    const S = await h.sec('MIDI');
    await learn(page, h, S, 'zPush');
    await h.wait(700);
    await page.evaluate(() => window.__midi.cc(21, 40));
    await h.check((s) => document.querySelectorAll(`${s} .rw-learn-row`).length === 1, 'MIDI binding learned', S);
  });

  await seg('play', async () => {
    await h.glide({ x: 980, y: 450 }, 40);
    for (let i = 0; i <= 60; i++) {
      await page.evaluate((v) => window.__midi.cc(21, v), Math.round(64 + 60 * Math.sin(i / 6)));
      await h.wait(70);
    }
  });

  await seg('clock', async () => {
    await page.evaluate(() => window.__midi.clock(128));
    const S = await h.sec('MIDI');
    await h.glide(await h.row('Clock Out', '.rw-toggle', S).catch(() => h.at(`${S} .rw-group-head`, 'Clock')), 30);
    await h.wait(2500);
  });

  await seg('osc', async () => {
    await page.evaluate(() => window.__midi.stopClock());
    await h.section('OSC');
    const S = await h.sec('OSC');
    await h.click(await h.row('URL', 'input', S));
    await page.keyboard.press('Control+A');
    await page.keyboard.type(`ws://127.0.0.1:${OSC_PORT}`, { delay: 45 });
    await page.keyboard.press('Tab');
    await h.click(`${S} .rw-btn`, 'Connect', { exact: true });
    for (let i = 0; i < 30 && !osc.connected; i++) await h.wait(100);
    if (!osc.connected) throw new Error('OSC bridge stand-in never connected');
    await h.wait(800);
  });

  await seg('osclearn', async () => {
    const S = await h.sec('OSC');
    await learn(page, h, S, 'hSize');
    await h.wait(600);
    osc.send({ address: '/fader/1', args: [0.6] });
    await h.check((s) => document.querySelectorAll(`${s} .rw-learn-row`).length === 1, 'OSC binding learned', S);
  });

  await seg('oscplay', async () => {
    await h.glide({ x: 980, y: 450 }, 40);
    for (let i = 0; i <= 50; i++) {
      osc.send({ address: '/fader/1', args: [0.5 + 0.45 * Math.sin(i / 5)] });
      await h.wait(70);
    }
    const S = await h.sec('OSC');
    await h.glide(await h.at(`${S} .rw-btn`, 'Copy TouchOSC layout'), 30);
  });

  await seg('outro', async () => { await h.glide({ x: 980, y: 450 }, 40); });
}
