// Lesson 7 — Function generators: a sine wave moving Z Push.
import { bootPattern } from '../lib/helpers.mjs';

export const lines = [
  { id: 'intro', text: 'Modulation moves parameters for you, so the picture keeps changing on its own. Open the Modulation section.' },
  { id: 'slots', text: 'Generators mode has four function generators. Each one is a source, a target, and an amount.' },
  { id: 'target', text: "Slot one's source is already a sine wave. Set its target to Z Push." },
  { id: 'enable', text: 'Switch the slot on.' },
  { id: 'amount', text: 'Amount is how far it swings. Turn it up, and the raster starts to breathe.' },
  { id: 'rate', text: 'Expand the slot for more. Rate sets how fast the wave cycles, in hertz.' },
  { id: 'outro', text: 'This slot also appears in the Patch Bay as Function Generator one. Next: the Timeline.' },
];
export const poster = 'rate';

export async function pre(page, h) {
  await bootPattern(page);
  await page.click('#panel-root .rw-tab[data-tab="synth"]');
}

const S = '#panel-root [data-mod-slot="0"]';

export async function run(page, seg, h) {
  await seg('intro', async () => { await h.wait(2600); await h.section('Modulation'); });

  await seg('slots', async () => {
    await h.reveal(`${S}`, null, 'start');
    await h.glide(await h.at('#panel-root .rw-mod-mode-switch button[data-mode="classic"]'), 30);
    await h.wait(600);
    for (let i = 0; i < 4; i++) { await h.glide(await h.at(`#panel-root [data-mod-slot="${i}"] .rw-mod-slot-src`), 15); await h.wait(250); }
  });

  await seg('target', async () => {
    await h.glide(await h.at(`${S} select.rw-mod-slot-src`), 20);
    await h.wait(500);
    await h.choose(await h.at(`${S} select.rw-mod-slot-tgt`), null, 'zPush');
  });

  await seg('enable', async () => {
    await h.click(`${S} label.rw-mod-slot-en`);
    await h.check(() => document.querySelector('#panel-root [data-mod-slot="0"] label.rw-mod-slot-en input')?.checked, 'slot 1 enabled');
  });

  await seg('amount', async () => {
    await h.knob(await h.at(`${S} .rw-mod-slot-amount .rw-knob`), 18, 50);
    await h.glide({ x: 980, y: 450 }, 40);
  });

  await seg('rate', async () => {
    await h.click(`${S} button.rw-mod-slot-expand`);
    await h.wait(500);
    const rate = await page.evaluate(() => {
      const r = [...document.querySelectorAll('#panel-root [data-mod-slot="0"] .rw-row')].find((e) => e.querySelector('.rw-label')?.textContent.trim() === 'Rate (Hz)');
      r?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return !!r;
    });
    if (!rate) throw new Error('no Rate row');
    await h.wait(800);
    await h.knob(await h.row('Rate (Hz)', '.rw-knob', '#panel-root [data-mod-slot="0"]'), 5, 30);
    await h.glide({ x: 980, y: 450 }, 40);
  });

  await seg('outro', async () => {});
}
