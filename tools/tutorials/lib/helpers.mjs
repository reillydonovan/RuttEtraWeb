// Shared tour helpers. Every lesson's run(page, seg, h) gets these as `h`.
// All pointer motion goes through page.mouse so the painted cursor follows.

export function helpers(page) {
  const h = {
    page,
    wait: (ms) => page.waitForTimeout(ms),

    /**
     * Center of the first visible element matching sel (optionally by text).
     * An element that exists but sits outside the view is smooth-scrolled in.
     */
    async at(sel, text, { exact = false, scroll = true } = {}) {
      const find = ([s, t, ex, sc]) => {
        const els = [...document.querySelectorAll(s)].filter((e) => {
          if (t == null) return true;
          const c = e.textContent.trim();
          return ex ? c === t : c.includes(t);
        }).filter((e) => e.getBoundingClientRect().width > 0);
        const onScreen = (e) => {
          const b = e.getBoundingClientRect();
          const x = b.x + b.width / 2, y = b.y + b.height / 2;
          if (!(x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight)) return false;
          const top = document.elementFromPoint(x, y);
          return !!top && (e.contains(top) || top.contains(e));
        };
        const el = els.find(onScreen);
        if (el) { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
        if (sc && els[0]) { els[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); return 'scrolled'; }
        return null;
      };
      let pt = await page.evaluate(find, [sel, text ?? null, exact, scroll]);
      if (pt === 'scrolled') { await h.settle(); pt = await page.evaluate(find, [sel, text ?? null, exact, false]); }
      if (!pt) throw new Error(`tour: nothing on screen for ${sel} ${text ?? ''}`);
      return pt;
    },

    /** Assert app state (in-page predicate) so dry runs catch clicks that did nothing. */
    async check(pred, msg, arg) {
      for (let i = 0; i < 20; i++) {
        if (await page.evaluate(pred, arg)) return;
        await page.waitForTimeout(100);
      }
      throw new Error(`tour check failed: ${msg}`);
    },

    /** Wait until smooth scrolling stops (page + every scroll container). */
    async settle() {
      let prev = '';
      for (let i = 0; i < 40; i++) {
        const cur = await page.evaluate(() => [...document.querySelectorAll('*')]
          .filter((e) => e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth)
          .map((e) => `${e.scrollTop},${e.scrollLeft}`).join('|'));
        if (cur === prev) return;
        prev = cur;
        await page.waitForTimeout(90);
      }
    },

    /** Reset the virtual camera (R) — blur first: keys are ignored while an input has focus. */
    async resetView() {
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.keyboard.press('r');
      await page.waitForTimeout(300);
    },

    async glide(pt, steps = 30) { await page.mouse.move(pt.x, pt.y, { steps }); },

    async click(sel, text, opts = {}) {
      const pt = typeof sel === 'string' ? await h.at(sel, text, opts) : sel;
      await h.glide(pt, opts.steps ?? 30);
      await h.wait(opts.pause ?? 220);
      await page.mouse.click(pt.x, pt.y, { button: opts.button ?? 'left' });
      return pt;
    },

    async drag(from, to, steps = 45) {
      await h.glide(from);
      await page.mouse.down();
      await h.wait(160);
      await page.mouse.move(to.x, to.y, { steps });
      await h.wait(220);
      await page.mouse.up();
    },

    /**
     * Patch Bay cable drag to a target that's scrolled out of view: hold the
     * cable in the bay's edge band (edge auto-pan scrolls the board) until
     * `findTarget()` (in-page fn → point|null, must be well inside the view)
     * resolves, then drop on it.
     */
    async dragPan(from, edgePt, findTarget, arg) {
      await h.glide(from);
      await page.mouse.down();
      await h.wait(160);
      await page.mouse.move(edgePt.x, edgePt.y, { steps: 35 });
      let to = null;
      for (let i = 0; i < 120 && !to; i++) {
        to = await page.evaluate(findTarget, arg);
        if (!to) await h.wait(60);
      }
      if (!to) { await page.mouse.up(); throw new Error('dragPan: target never scrolled into view'); }
      // Leave the edge band at once so the board stops, then settle on the jack.
      await page.mouse.move(to.x, Math.max(to.y, edgePt.y + 90), { steps: 6 });
      await h.wait(250);
      to = await page.evaluate(findTarget, arg) ?? to;
      await page.mouse.move(to.x, to.y, { steps: 25 });
      await h.wait(250);
      await page.mouse.up();
    },

    /** Vertical knob turn: positive dy = turn up. */
    async knob(pt, dy, steps = 50) {
      await h.drag(pt, { x: pt.x, y: pt.y - dy }, steps);
    },

    /** Scroll an element so `sel` is in view (smooth, recorded). */
    async reveal(sel, text, block = 'center') {
      await page.evaluate(([s, t, b]) => {
        const el = [...document.querySelectorAll(s)].find((e) => (t == null || e.textContent.includes(t)) && e.getBoundingClientRect().width > 0);
        el?.scrollIntoView({ behavior: 'smooth', block: b });
      }, [sel, text ?? null, block]);
      await h.settle();
    },

    /** Open a top menu and pick an item; middle labels are submenus (open on hover). */
    async menu(top, ...path) {
      const topPt = await h.click('#rw-menubar .rw-menubar-item', top, { exact: true, pause: 250 });
      await h.wait(400);
      // Hovering another top button switches menus, so leave the bar
      // straight down before moving sideways to the first item.
      const first = await h.at('.rw-menu li .rw-menu-label', path[0], { exact: true });
      await h.glide({ x: topPt.x, y: first.y }, 12);
      let prev = { x: topPt.x, y: first.y };
      for (let i = 0; i < path.length; i++) {
        const pt = await h.at('.rw-menu li .rw-menu-label', path[i], { exact: true });
        // Into a submenu: go sideways first so the path never crosses a
        // sibling item (that would close the submenu, as in any real menu).
        if (prev) await h.glide({ x: pt.x, y: prev.y }, 15);
        if (i < path.length - 1) { await h.glide(pt, 20); await h.wait(500); prev = pt; }
        else await h.click(pt, null, { steps: 20, pause: 300 });
      }
      await h.wait(500);
    },

    /** Center of `inner` inside the visible panel row whose label is `label`. */
    async row(label, inner = '.rw-knob', scope = '#panel-root') {
      const pt = await page.evaluate(([l, s, sc]) => {
        const rows = [...document.querySelectorAll(`${sc} .rw-row`)].filter((r) => r.querySelector('.rw-label')?.textContent.trim() === l);
        for (const r of rows) {
          const el = r.querySelector(s);
          const b = el?.getBoundingClientRect();
          if (b && b.width > 0 && b.y >= 0 && b.bottom <= innerHeight) return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }
        return null;
      }, [label, inner, scope]);
      if (!pt) throw new Error(`tour: no visible row "${label}" ${inner}`);
      return pt;
    },

    /** Point at a native <select> and set it (native dropdowns don't record well). */
    async choose(pt, selector, value) {
      await h.glide(pt);
      await h.wait(250);
      await page.evaluate(([x, y]) => {
        const r = document.createElement('div');
        Object.assign(r.style, { position: 'fixed', left: (x - 18) + 'px', top: (y - 18) + 'px', width: '36px', height: '36px',
          borderRadius: '50%', border: '2px solid #7dff9a', zIndex: '2147483646', pointerEvents: 'none', transition: 'all .45s ease-out' });
        document.documentElement.appendChild(r);
        requestAnimationFrame(() => { r.style.transform = 'scale(1.8)'; r.style.opacity = '0'; });
        setTimeout(() => r.remove(), 600);
      }, [pt.x, pt.y]);
      await page.evaluate(([x, y, v]) => {
        const sel = document.elementsFromPoint(x, y).map((e) => e.closest('select')).find(Boolean);
        if (!sel) throw new Error('no select at point');
        sel.value = v;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, [pt.x, pt.y, value]);
      void selector;
    },

    /**
     * Selector prefix for one visible panel section, by title — labels like
     * "Connect" or "URL" repeat across sections. Usage: `${await h.sec('OSC')} .rw-btn`.
     */
    async sec(title) {
      const tag = title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const ok = await page.evaluate(([t, tg]) => {
        const head = [...document.querySelectorAll('#panel-root .rw-section-head')]
          .find((e) => e.querySelector('span')?.textContent.trim() === t && e.getBoundingClientRect().width > 0);
        if (!head) return false;
        head.parentElement.dataset.tut = tg;
        return true;
      }, [title, tag]);
      if (!ok) throw new Error(`no visible section ${title}`);
      return `#panel-root [data-tut="${tag}"]`;
    },

    /** Selector prefix for one visible `.rw-group` by its heading text. */
    async grp(title) {
      const tag = `g-${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
      const ok = await page.evaluate(([t, tg]) => {
        const head = [...document.querySelectorAll('#panel-root .rw-group-head')]
          .find((e) => e.textContent.trim() === t && e.getBoundingClientRect().width > 0);
        if (!head) return false;
        head.closest('.rw-group').dataset.tut = tg;
        return true;
      }, [title, tag]);
      if (!ok) throw new Error(`no visible group ${title}`);
      return `#panel-root [data-tut="${tag}"]`;
    },

    /** Center of the visible leaf element inside `scope` whose text is exactly `text`
     *  (for hand-built controls that don't use the standard row markup). */
    async text(scope, text) {
      const find = ([sc, t, scroll]) => {
        const els = [...document.querySelectorAll(`${sc} *`)].filter((e) => e.children.length === 0
          && e.textContent.trim() === t && e.getBoundingClientRect().width > 0);
        const ok = els.find((e) => { const b = e.getBoundingClientRect(); return b.y >= 40 && b.bottom <= innerHeight; });
        if (ok) { const b = ok.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
        if (scroll && els[0]) { els[0].scrollIntoView({ behavior: 'smooth', block: 'center' }); return 'scrolled'; }
        return null;
      };
      let pt = await page.evaluate(find, [scope, text, true]);
      if (pt === 'scrolled') { await h.settle(); pt = await page.evaluate(find, [scope, text, false]); }
      if (!pt) throw new Error(`tour: no visible text "${text}" in ${scope}`);
      return pt;
    },

    /** Center of `inner` in the row labelled `label` inside section `title`. */
    async secRow(title, label, inner) {
      return h.row(label, inner, await h.sec(title));
    },

    /** Open a (visible) panel section by title, if closed, and scroll it into view. */
    async section(title, { scrollOnly = false } = {}) {
      const state = await page.evaluate(([t, so]) => {
        const head = [...document.querySelectorAll('#panel-root .rw-section-head')]
          .find((e) => e.querySelector('span')?.textContent.trim() === t && e.getBoundingClientRect().width > 0);
        if (!head) return null;
        head.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return so || !head.parentElement.classList.contains('collapsed') ? 'open' : 'closed';
      }, [title, scrollOnly]);
      if (state === null) throw new Error(`no visible section ${title}`);
      await h.settle();
      if (state === 'closed') {
        await h.click('#panel-root .rw-section-head > span', title, { exact: true });
        await h.wait(400);
      }
    },

    /** A full-screen lower-third style caption card; fades on its own. */
    async card(kicker, title, ms = 2600) {
      await page.evaluate(([k, t, d]) => {
        const c = document.createElement('div');
        c.innerHTML = `<div style="font:14px 'Share Tech Mono',monospace;letter-spacing:.3em;color:#6fdc8c;opacity:.85">${k}</div>
          <div style="font:46px VT323,monospace;color:#b8ffc8;margin-top:6px;text-shadow:0 0 18px rgba(80,255,140,.45)">${t}</div>`;
        Object.assign(c.style, { position: 'fixed', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', background: 'rgba(4,10,6,.92)', zIndex: '2147483600', pointerEvents: 'none',
          transition: 'opacity .7s ease' });
        document.documentElement.appendChild(c);
        setTimeout(() => { c.style.opacity = '0'; }, d);
        setTimeout(() => c.remove(), d + 800);
      }, [kicker, title, ms]);
    },
  };
  return h;
}

/** Common pre-roll: wait for the app, choose the PATTERN source (not recorded). */
export async function bootPattern(page) {
  await page.click('#boot-pattern');
  await page.waitForTimeout(1200);
}
