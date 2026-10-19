// Timeline track — Keyframing the camera: Virtual Camera ▸ Transform, Key camera at two bars, play.
import { bootPattern } from '../lib/helpers.mjs';

export const lines = [
  { id: 'intro', text: "The camera can be keyframed like any knob. Its position and rotation live in Virtual Camera, under Transform." },
  { id: 'orbit', text: 'Orbit the view, and the six numbers follow. Position X, Y and Z, and rotation, in degrees.' },
  { id: 'new', text: 'Make a timeline with the plus button, and put the playhead on bar one.' },
  { id: 'key1', text: 'Press Key camera. All six values are keyed at the playhead, in one step.' },
  { id: 'preview', text: 'Move to bar five, and orbit somewhere new. Now that the camera has keyframes, a drag only previews. Nothing is written yet, and the panel says so.' },
  { id: 'key2', text: 'Press Key camera again to keep this view as the second key.' },
  { id: 'play', text: 'Press Stop to go back to the start, then Play. The camera travels from the first key to the second, then the timeline loops. Rotation takes the short way round.' },
  { id: 'outro', text: 'Type a value to place the camera exactly, or patch an L F O into any of the six. There is no scale: field of view is the zoom.' },
];
export const poster = 'play';

const num = (k) => `#panel-root [data-param-key="${k}"] input.rw-num`;          // value (hidden under the knob face)
const face = (k) => `#panel-root [data-param-key="${k}"] .rw-slider-readout`;  // what's on screen

export async function pre(page, h) {
  await bootPattern(page);
  await page.click('#panel-root .rw-tab[data-tab="synth"]');
  await h.section('Virtual Camera');
  await h.reveal('#panel-root [data-param-key="camPosX"]', null, 'start');
}

async function rulerAt(page, bar) {
  return page.evaluate((n) => {
    const r = document.querySelector('#timeline-dock .rw-tl-ruler').getBoundingClientRect();
    return { x: r.x + n * 60 + 1, y: r.y + r.height / 2 };
  }, bar);
}

export async function run(page, seg, h) {
  await seg('intro', async () => {
    await h.wait(2800);   // the lesson title card covers the screen until then
    for (const k of ['camPosX', 'camPosY', 'camPosZ', 'camRotX', 'camRotY', 'camRotZ']) {
      await h.glide(await h.at(face(k)), 14);
      await h.wait(220);
    }
  });

  await seg('orbit', async () => {
    const before = await page.evaluate((s) => +document.querySelector(s).value, num('camRotY'));
    await h.drag({ x: 980, y: 470 }, { x: 1180, y: 420 }, 70);
    await h.wait(1500);
    await h.check(([s, b]) => Math.abs(+document.querySelector(s).value - b) > 1, 'transform follows the orbit', [num('camRotY'), before]);
    await h.glide(await h.at(face('camRotY')), 25);
  });

  await seg('new', async () => {
    await h.click('#timeline-dock [data-tl="new"]');
    await h.check(() => !!document.querySelector('#panel-root [data-param-key="camPosX"] > .rw-kf-diamond:not([hidden])'), 'timeline created');
    await h.click(await rulerAt(page, 1));
  });

  await seg('key1', async () => {
    await h.click('#panel-root .rw-btn', 'Key camera');
    await h.check(() => document.querySelectorAll('.rw-tl-lane-row').length >= 6, 'six camera lanes');
    await h.wait(800);
  });

  await seg('preview', async () => {
    await h.click(await rulerAt(page, 5));
    await h.wait(400);
    const before = await page.evaluate((s) => +document.querySelector(s).value, num('camRotY'));
    await h.drag({ x: 1150, y: 520 }, { x: 860, y: 400 }, 80);
    await h.wait(1200);
    await h.check(() => [...document.querySelectorAll('#panel-root .rw-hint')].some((n) => /Previewing/.test(n.textContent || '')), 'the panel says it is previewing');
    await h.check(([s, b]) => Math.abs(+document.querySelector(s).value - b) < 1e-6, 'nothing written during the preview', [num('camRotY'), before]);
    await h.glide(await h.at('#panel-root .rw-hint', 'Previewing'), 30);
    await h.wait(1200);
  });

  await seg('key2', async () => {
    await h.click('#panel-root .rw-btn', 'Key camera');
    await h.check(() => ![...document.querySelectorAll('#panel-root .rw-hint')].some((n) => /Previewing/.test(n.textContent || '')), 'view kept as a key');
    await h.wait(800);
  });

  await seg('play', async () => {
    // Back to the start first: playing from the last key would never show the move between keys.
    await h.click('#timeline-dock [data-tl="stop"]');
    await h.check(() => /bar 0\.00/.test(document.querySelector('#timeline-dock')?.textContent ?? ''), 'playhead at the start');
    await h.click('#timeline-dock [data-tl="play"]');
    await h.glide({ x: 1000, y: 430 }, 40);
    await h.wait(12000);
  });

  await seg('outro', async () => {
    await h.glide(await h.at(face('camPosZ')), 30);
    await h.wait(800);
  });
}
