// Lesson — Reading the Patch Bay: the faceplate, ⓘ diagrams, zoom/pan, free layout, why a cable won't connect.
import { bootPattern } from '../lib/helpers.mjs';
import { findJack } from '../lib/bay.mjs';

export const lines = [
  { id: 'intro', text: 'The Patch Bay is the whole instrument, drawn as a hardware faceplate. Maximize it, and everything is in front of you at once.' },
  { id: 'sources', text: 'Along the top is the Sources bus: every signal you can patch from. Waveforms, audio, beats, MIDI, and the joystick.' },
  { id: 'cells', text: 'Every parameter gets a cell. An input jack on the left, a knob with its number, and an output jack on the right. Turn a knob here, and the same parameter moves in the Controls panel.' },
  { id: 'info', text: 'Each module has a small i button. It opens an info panel, with a diagram of everything patched into that module right now. As you add cables, the diagram follows.' },
  { id: 'zoom', text: 'Scroll to zoom the board toward your cursor, and drag empty background to pan. The hundred percent button puts it back.' },
  { id: 'free', text: 'Free breaks every module out, so you can arrange the board like a canvas. Tidy snaps them back into stacks. Dragging any module by its header does the same for just that one.' },
  { id: 'reject', text: 'Cables run from an output into an input. Try something that cannot work, and the jack glows red and tells you why.' },
  { id: 'outro', text: 'Next, the cables themselves.' },
];
export const poster = 'info';

export async function pre(page) { await bootPattern(page); }

const jack = async (page, q) => {
  const p = await page.evaluate(findJack, q);
  if (!p) throw new Error(`no visible jack ${JSON.stringify(q)}`);
  return p;
};

/** Center of a given element inside the first faceplate cell labelled `label`. */
const cellPart = (page, label, sel) => page.evaluate(([l, s]) => {
  const top = [...document.querySelectorAll('.rw-patchbay .rw-pb-cell-top')]
    .find((c) => c.textContent.trim().startsWith(l) && !c.closest('.rw-pb-module') && c.getBoundingClientRect().width > 0);
  const el = top?.parentElement?.querySelector(s);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}, [label, sel]);

export async function run(page, seg, h) {
  await seg('intro', async () => { await h.wait(2600); await h.click('#rw-left-shell .rw-region-max-btn'); await h.wait(500); });

  await seg('sources', async () => {
    for (const b of ['SINE', 'SAW', 'AUDIO ENV', 'BEAT', 'MIDI CC', 'JOY X']) { await h.glide(await jack(page, { bus: b }), 16); await h.wait(300); }
  });

  await seg('cells', async () => {
    const knob = await cellPart(page, 'Z Push', '.rw-pbknob');
    if (!knob) throw new Error('no Z Push knob');
    await h.glide(await jack(page, { param: 'Z Push' }), 30);
    await h.wait(500);
    await h.glide(knob, 20);
    await h.wait(300);
    await h.knob(knob, 40, 40);
    await h.check(() => document.querySelector('#panel-root [data-param-key="zPush"]') !== null, 'controls panel present');
    await h.wait(500);
    await h.glide(await jack(page, { param: 'Z Push', out: true }), 25);
  });

  await seg('info', async () => {
    const pt = await page.evaluate(() => {
      const m = [...document.querySelectorAll('.rw-patchbay .rw-info-btn')]
        .find((b) => (b.parentElement?.textContent ?? '').trim().startsWith('POSITION & SIZE') && b.getBoundingClientRect().width > 0);
      const b = m?.getBoundingClientRect();
      return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
    });
    if (!pt) throw new Error('no ⓘ on POSITION & SIZE in view');
    await h.click(pt);
    await h.check(() => !!document.querySelector('.rw-info-modal'), 'info modal open');
    await h.wait(3800);
    await h.click('.rw-info-close');
    await h.check(() => !document.querySelector('.rw-info-modal'), 'info modal closed');
  });

  await seg('zoom', async () => {
    const at = await h.at('.rw-pb-board');
    await h.glide({ x: at.x + 60, y: at.y }, 20);
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -160); await h.wait(160); }
    await h.check(() => !/^100%$/.test([...document.querySelectorAll('.rw-pb-zoombar button')].map((b) => b.textContent).find((t) => t.endsWith('%')) ?? ''), 'zoomed in');
    await h.wait(700);
    const e = await h.emptyBaySpot();
    await h.drag(e, { x: e.x - 220, y: e.y - 120 }, 40);
    await h.wait(500);
    await h.click('.rw-pb-zoombar button', '%');   // the readout button resets to 100%
    await h.check(() => [...document.querySelectorAll('.rw-pb-zoombar button')].some((b) => b.textContent === '100%'), 'zoom reset');
    // Panning moved the view; glide it home so the toolbar is back on screen.
    await page.evaluate(() => document.querySelector('.rw-patchbay').scrollTo({ left: 0, top: 0, behavior: 'smooth' }));
    await h.settle();
    await h.wait(400);
  });

  await seg('free', async () => {
    await h.click('.rw-pb-tools .rw-pb-tidy', 'FREE', { exact: true });
    await h.check(() => [...document.querySelectorAll('.rw-pb-tools .rw-pb-tidy')].some((b) => b.textContent === 'TIDY'), 'free layout');
    await h.wait(1200);
    const head = await h.at('.rw-pb-unit-free .rw-pb-unit-handle', 'BEAM');
    await h.drag(head, { x: head.x + 380, y: head.y + 150 }, 50);
    await h.wait(900);
    await h.click('.rw-pb-tools .rw-pb-tidy', 'TIDY', { exact: true });
    await h.check(() => [...document.querySelectorAll('.rw-pb-tools .rw-pb-tidy')].some((b) => b.textContent === 'FREE'), 'tidy layout');
    await h.wait(1000);
  });

  await seg('reject', async () => {
    await page.evaluate(() => document.querySelector('.rw-patchbay').scrollTo({ left: 0, top: 0, behavior: 'smooth' }));
    await h.settle();
    const from = await jack(page, { bus: 'SINE' });
    const to = await jack(page, { param: 'Z Push' });
    await h.glide(from);
    await page.mouse.down();
    await h.wait(200);
    await page.mouse.move(to.x + 40, to.y + 60, { steps: 25 });
    await page.mouse.move(to.x, to.y, { steps: 20 });
    await h.check(() => !!document.querySelector('.rw-rack-jack--reject'), 'jack shows reject');
    await h.wait(3400);
    const e = await h.emptyBaySpot();
    await page.mouse.move(e.x, e.y, { steps: 20 });
    await page.mouse.up();
    await h.wait(500);
  });

  await seg('outro', async () => { await h.wait(1200); });
}
