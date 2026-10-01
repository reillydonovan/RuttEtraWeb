// In-page Patch Bay jack finder (passed to page.evaluate, so self-contained).
//
//   { bus: 'TRI' }                         a SOURCES bus jack
//   { param: 'Z Push' }                    faceplate param IN jack ({ param, out: true } = its OUT)
//   { mod: 'FUNCTION GEN 1', srcin: true } a module's SRC IN
//   { mod: 'COMPOSITE', row: 'B' }         a module jack whose row label starts with `row`
//   { mod: 'LFO', out: true }              a module's (first) OUT jack
// `margin` = how far inside the visible bay (vertically) the jack must be (else null).

export function findJack(q) {
  const bay = document.querySelector('.rw-patchbay');
  if (!bay) return null;
  const vb = bay.getBoundingClientRect();
  const m = q.margin ?? 4;
  let jack = null;
  const label = (j) => (j.closest('div')?.textContent ?? '').trim();
  if (q.bus) {
    jack = [...bay.querySelectorAll('.rw-rack-jack')].find((j) => j.parentElement.textContent.trim() === q.bus);
  } else if (q.param) {
    const cell = [...bay.querySelectorAll('.rw-pb-cell-top')].find((c) => c.textContent.trim().startsWith(q.param)
      && !c.closest('.rw-pb-module'));
    const scope = cell?.parentElement;
    jack = q.out ? scope?.querySelector('.rw-pb-jack--paramout') : cell?.querySelector('.rw-rack-jack--in');
  } else if (q.mod) {
    const mod = [...bay.querySelectorAll('.rw-pb-module, .rw-pb-graphnode')]
      .reverse()
      .find((e) => (e.querySelector('.rw-pb-module-head')?.textContent ?? '').trim().startsWith(q.mod));
    if (mod) {
      let jacks = [...mod.querySelectorAll('.rw-rack-jack')];
      if (q.srcin) jacks = jacks.filter((j) => j.className.includes('srcin'));
      else if (q.out != null) jacks = jacks.filter((j) => j.className.includes('--out') === !!q.out && !j.className.includes('paramout'));
      if (q.row) jacks = jacks.filter((j) => label(j).startsWith(q.row));
      jack = jacks[0];
    }
  }
  if (!jack) return null;
  const b = jack.getBoundingClientRect();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  if (x < vb.left + 4 || x > vb.right - 4 || y < vb.top + m || y > vb.bottom - m) return null;
  return { x, y };
}

/** Patch Bay module element center by head text (in-page). */
export function findModule(title) {
  const mod = [...document.querySelectorAll('.rw-pb-module, .rw-pb-graphnode')].reverse()
    .find((e) => (e.querySelector('.rw-pb-module-head')?.textContent ?? '').trim().startsWith(title));
  if (!mod) return null;
  const b = mod.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, top: b.top, bottom: b.bottom };
}

/** Smoothly scroll the bay so a module's head sits near the top (in-page). */
export function scrollToModule(title) {
  const bay = document.querySelector('.rw-patchbay');
  const mod = [...bay.querySelectorAll('.rw-pb-module, .rw-pb-graphnode')]
    .find((e) => (e.querySelector('.rw-pb-module-head')?.textContent ?? '').trim().startsWith(title));
  const dy = mod.getBoundingClientRect().top - bay.getBoundingClientRect().top - 120;
  bay.scrollBy({ top: dy, behavior: 'smooth' });
}
