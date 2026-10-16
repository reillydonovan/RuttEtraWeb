// Lesson — Patch Bay power moves: parameter→parameter, Note nodes, the same patch in Controls, popouts.
import { bootPattern } from '../lib/helpers.mjs';
import { findJack } from '../lib/bay.mjs';

export const lines = [
  { id: 'intro', text: 'A few moves turn the Patch Bay into an instrument. First: one parameter driving another.' },
  { id: 'paramout', text: 'Every parameter has an output jack as well as an input. Drag the output of Z Push onto the input of H Size. Now the width follows the depth, and a Param Out node carries the signal behind the scenes.' },
  { id: 'note', text: 'Right-click empty space, and add a Note. Type on it. Notes are labels that live in the patch, so you can explain what a patch is for.' },
  { id: 'controls', text: 'Restore the window, and open Modulation in the Controls panel. The cable you just made is a row there. The Patch Bay and the Controls panel are two views of one patch.' },
  { id: 'popout', text: 'For two displays, the pop-out button on a window sends it to a browser window of its own. It stays live, and the main window keeps working.' },
  { id: 'save', text: 'Save a preset or a project, and every cable and note goes with it. Open it later, here or on another machine, and it all comes back.' },
  { id: 'outro', text: 'That is the Patch Bay. The next level up is the Graph engine.' },
];
export const poster = 'controls';

export async function pre(page) { await bootPattern(page); }

const jack = async (page, q) => {
  const p = await page.evaluate(findJack, q);
  if (!p) throw new Error(`no visible jack ${JSON.stringify(q)}`);
  return p;
};

export async function run(page, seg, h) {
  await seg('intro', async () => { await h.wait(2600); await h.click('#rw-left-shell .rw-region-max-btn'); await h.wait(500); });

  await seg('paramout', async () => {
    const from = await jack(page, { param: 'Z Push', out: true });
    await h.glide(from, 30);
    await h.wait(500);
    const to = await jack(page, { param: 'H Size' });
    await h.drag(from, to, 55);
    await h.check(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.rw-rack-jack--plugged'), 'H Size input is patched', [to.x, to.y]);
    await h.wait(1200);
  });

  await seg('note', async () => {
    await h.click(await h.emptyBaySpot(), null, { button: 'right' });
    await h.wait(700);
    await h.click('.rw-pb-addnode-menu .rw-graph-palette-item', 'Note', { exact: true, steps: 25 });
    await h.check(() => !!document.querySelector('.rw-pb-graphnode textarea'), 'note added');
    await h.click('.rw-pb-graphnode textarea');
    await page.keyboard.press('Control+A');   // a new Note starts with placeholder text
    await page.keyboard.type('Depth drives width', { delay: 90 });
    await h.check(() => document.querySelector('.rw-pb-graphnode textarea')?.value === 'Depth drives width', 'note text');
    await h.wait(900);
  });

  await seg('controls', async () => {
    await h.click('#rw-left-shell .rw-region-max-btn');
    await h.wait(700);
    await h.section('Modulation');
    await h.check(() => document.querySelectorAll('#panel-root .rw-beginner-rows > *').length > 0, 'a row for the cable');
    await h.reveal('#panel-root .rw-beginner-rows', null, 'start');
    await h.glide(await h.at('#panel-root .rw-beginner-rows > *'), 30);
    await h.wait(900);
  });

  await seg('popout', async () => {
    await h.glide(await h.at('#rw-left-shell .rw-region-btn', '⧉', { exact: true }), 35);
    await h.wait(1500);
  });

  await seg('save', async () => { await h.glide({ x: 980, y: 450 }, 40); await h.wait(1500); });

  await seg('outro', async () => { await h.wait(1200); });
}
