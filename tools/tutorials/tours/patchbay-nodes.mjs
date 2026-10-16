// Lesson 11 — Patch Bay nodes: add an LFO and a Scope, wire them, delete one.
import { bootPattern } from '../lib/helpers.mjs';
import { findJack, findModule } from '../lib/bay.mjs';

export const lines = [
  { id: 'intro', text: 'Nodes are extra modules: oscillators, envelopes, logic, and more. Right-click empty board space to add one. An LFO.' },
  { id: 'scope', text: 'Add a Scope beside it. A scope draws whatever signal passes through it.' },
  { id: 'wire', text: "Drag the LFO's output into the Scope's input. There's the wave." },
  { id: 'through', text: "The Scope passes its signal on. Patch its output into Z Push, and the raster follows the wave." },
  { id: 'rate', text: "Turn the LFO's rate knob, and watch the trace speed up." },
  { id: 'delete', text: 'To remove a node, click its X and confirm. Its cables go with it.' },
  { id: 'outro', text: 'Every node type is listed in the Node Catalog on the About page. Next: routing video.' },
];
export const poster = 'rate';

export async function pre(page, h) {
  await bootPattern(page);
  await page.click('#rw-left-shell .rw-region-max-btn');
  await h.wait(600);
}

const jack = async (page, q) => {
  const p = await page.evaluate(findJack, q);
  if (!p) throw new Error(`no visible jack ${JSON.stringify(q)}`);
  return p;
};

/** True if (x, y) is plain board background. */
const isEmpty = ([x, y]) => {
  const el = document.elementFromPoint(x, y);
  return !!el && !!el.closest('.rw-patchbay') && !el.closest('.rw-pb-module, .rw-pb-graphnode, .rw-pb-field, button, input, select');
};

export async function run(page, seg, h) {
  await seg('intro', async () => {
    await h.wait(2700);
    await h.click(await h.emptyBaySpot(), null, { button: 'right' });
    await h.wait(700);
    await h.click('.rw-pb-addnode-menu .rw-graph-palette-item', 'LFO', { exact: true, steps: 25 });
    await h.wait(500);
    // Spawning switches to free layout (adds pan headroom): bring the node up.
    await page.evaluate(() => {
      const bay = document.querySelector('.rw-patchbay');
      const mod = [...document.querySelectorAll('.rw-pb-graphnode')].pop();
      const dy = mod.getBoundingClientRect().bottom - (innerHeight - 40);
      if (dy > 0) bay.scrollBy({ top: dy, behavior: 'smooth' });
    });
    await h.wait(900);
  });

  await seg('scope', async () => {
    const lfo = await page.evaluate(findModule, 'LFO');
    let spot = null;
    // Beside the LFO, else below it (the generator rail sits against the board's left edge).
    const cands = [260, 320, 380, 440].map((dx) => ({ x: lfo.x + dx, y: lfo.top + 40 }))
      .concat([-200, -170].map((dx) => ({ x: lfo.x + dx, y: lfo.top + 40 })))
      .concat([0, -60, 60].map((dx) => ({ x: lfo.x + dx, y: lfo.bottom + 60 })));
    for (const p of cands) {
      if (await page.evaluate(isEmpty, [p.x, p.y])) { spot = p; break; }
    }
    if (!spot) throw new Error('no empty board space beside the LFO');
    await h.click(spot, null, { button: 'right' });
    await h.wait(700);
    await h.click('.rw-pb-addnode-menu .rw-graph-palette-item', 'Scope', { exact: true, steps: 25 });
    await h.wait(700);
    // The new node lands in the nearest free spot: bring it (and the LFO above it) into view.
    await page.evaluate(() => {
      const bay = document.querySelector('.rw-patchbay');
      const mod = [...document.querySelectorAll('.rw-pb-graphnode')].pop();
      const r = mod.getBoundingClientRect(), b = bay.getBoundingClientRect();
      const dy = r.bottom - (b.bottom - 80);
      if (dy > 0) bay.scrollBy({ top: dy, behavior: 'smooth' });
    });
    await h.settle();
  });

  await seg('wire', async () => {
    await h.drag(await jack(page, { mod: 'LFO', out: true }), await jack(page, { mod: 'Scope', out: false }), 50);
    await h.wait(400);
    await h.glide(await page.evaluate(findModule, 'Scope'), 30);
  });

  await seg('through', async () => {
    const from = await jack(page, { mod: 'Scope', out: true });
    const to = await page.evaluate(findJack, { param: 'Z Push', margin: 50 });
    if (to) await h.drag(from, to, 60);
    else await h.dragPan(from, { x: 420, y: 66 }, findJack, { param: 'Z Push', margin: 60 });
    await h.check(() => [...document.querySelectorAll('.rw-patchbay .rw-pb-cell-top')]
      .find((c) => c.textContent.trim().startsWith('Z Push') && !c.closest('.rw-pb-module'))
      ?.querySelector('.rw-rack-jack--in')?.classList.contains('rw-rack-jack--plugged'), 'Z Push patched');
  });

  await seg('rate', async () => {
    const knob = await page.evaluate(() => {
      const m = [...document.querySelectorAll('.rw-pb-graphnode')].find((e) => e.querySelector('.rw-pb-module-head')?.textContent.trim().startsWith('LFO'));
      const k = m.querySelector('.rw-pbknob');
      k.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const b = k.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await h.wait(500);
    await h.knob(knob, 40, 50);
    await h.glide(await page.evaluate(findModule, 'Scope'), 30);
  });

  await seg('delete', async () => {
    const del = await page.evaluate(() => {
      const m = [...document.querySelectorAll('.rw-pb-graphnode')].find((e) => e.querySelector('.rw-pb-module-head')?.textContent.trim().startsWith('Scope'));
      const b = m.querySelector('.rw-pb-graphnode-del').getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    });
    await h.click(del);
    await h.check(() => ![...document.querySelectorAll('.rw-pb-graphnode .rw-pb-module-head')].some((e) => e.textContent.trim().startsWith('Scope')), 'scope deleted');
  });

  await seg('outro', async () => { await h.glide({ x: 980, y: 500 }, 40); });
}
