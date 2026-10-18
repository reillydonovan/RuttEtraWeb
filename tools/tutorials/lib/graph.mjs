// Advanced graph editor helpers (Controls ▸ Modulation ▸ Graph ▸ Advanced).

/** In-page: center of a node's port dot. Nodes are found by header label (last match wins). */
export function findPort([label, port, side, nth]) {
  const nodes = [...document.querySelectorAll('#panel-root .rw-graph-node')]
    .filter((n) => n.querySelector('.rw-graph-node-title')?.textContent.trim().replace(/\s*·muted$/, '') === label);
  const node = nth == null ? nodes[nodes.length - 1] : nodes[nth];
  const dot = node?.querySelector(`.rw-graph-port-dot[data-port="${port}"][data-side="${side}"]`);
  if (!dot) return null;
  const b = dot.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** In-page: center of a node's header. */
export function findNodeHead([label, nth]) {
  const nodes = [...document.querySelectorAll('#panel-root .rw-graph-node')]
    .filter((n) => n.querySelector('.rw-graph-node-title')?.textContent.trim().replace(/\s*·muted$/, '') === label);
  const node = nth == null ? nodes[nodes.length - 1] : nodes[nth];
  const b = node?.querySelector('.rw-graph-node-head')?.getBoundingClientRect();
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
}

export function graphHelpers(page, h) {
  const g = {
    /** Open Modulation, switch to Graph mode and the Advanced view, maximize Controls. */
    async open({ maximize = true } = {}) {
      await page.click('#panel-root .rw-tab[data-tab="synth"]');
      await h.section('Modulation');
      await h.click('#panel-root .rw-mod-mode-switch button[data-mode="graph"]');
      await h.wait(1200);
      await h.click('#panel-root .rw-graph-view-btn', 'Advanced', { exact: true });
      await h.wait(700);
      if (maximize) {
        await h.click('#panel-root .rw-region-max-btn');
        await h.wait(900);
      }
      await h.section('Modulation', { scrollOnly: true });
    },

    /** Click a palette item; the new node appears selected near the canvas top-left. */
    async add(label) {
      await h.click('#panel-root .rw-graph-palette-item', label, { exact: true, steps: 20 });
      await h.wait(450);
    },

    /** Drag a node by its header to a canvas point (relative to the canvas top-left). */
    async place(label, rx, ry) {
      const c = await page.evaluate(() => {
        const b = document.querySelector('#panel-root .rw-graph-canvas').getBoundingClientRect();
        return { x: b.x, y: b.y };
      });
      const from = await page.evaluate(findNodeHead, [label, null]);
      if (!from) throw new Error(`no graph node ${label}`);
      await h.drag(from, { x: c.x + rx, y: c.y + ry }, 30);
      await h.wait(200);
    },

    async port(label, port, side, nth) {
      const p = await page.evaluate(findPort, [label, port, side, nth ?? null]);
      if (!p) throw new Error(`no port ${label}.${port} (${side})`);
      return p;
    },

    /** Wire an output port to an input port by dragging. */
    async wire(fromLabel, fromPort, toLabel, toPort) {
      await h.drag(await g.port(fromLabel, fromPort, 'out'), await g.port(toLabel, toPort, 'in'), 35);
      await h.wait(250);
    },

    /** Select a node (click its header). */
    async select(label) {
      const p = await page.evaluate(findNodeHead, [label, null]);
      await h.click(p);
      await h.wait(300);
    },

    /** Set an inspector param of the selected node (range input or select). */
    async param(name, value) {
      const pt = await page.evaluate((n) => {
        // Labels are display names now ("cutoffHz" shows as "Cutoff Hz"): match either form.
        const squash = (s) => s.toLowerCase().replace(/[\s_-]/g, '');
        const row = [...document.querySelectorAll('#panel-root .rw-graph-inspector-row')]
          .find((r) => {
            const t = r.querySelector('.rw-graph-inspector-label')?.textContent.trim() ?? '';
            return t === n || squash(t) === squash(n);
          });
        const el = row?.querySelector('input[type=range], select, input[type=checkbox]');
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }, name);
      if (!pt) throw new Error(`no inspector param ${name}`);
      await h.glide(pt, 20);
      await h.wait(200);
      await page.evaluate(([n, v]) => {
        const squash = (s) => s.toLowerCase().replace(/[\s_-]/g, '');
        const row = [...document.querySelectorAll('#panel-root .rw-graph-inspector-row')]
          .find((r) => {
            const t = r.querySelector('.rw-graph-inspector-label')?.textContent.trim() ?? '';
            return t === n || squash(t) === squash(n);
          });
        const el = row.querySelector('input[type=range], select, input[type=checkbox]');
        if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, [name, value]);
      await h.wait(300);
    },

    /** Add a target binding to the selected node and point it at `target` with `amount`. */
    async bind(target, amount) {
      // The inspector scrolls inside its own column; the Bindings block can sit below its fold.
      await h.reveal('#panel-root .rw-graph-add-binding', null, 'center');
      const before = await page.evaluate(() => document.querySelectorAll('#panel-root .rw-graph-binding').length);
      await h.click('#panel-root .rw-graph-add-binding');
      await h.check((n) => document.querySelectorAll('#panel-root .rw-graph-binding').length > n, 'binding row added', before);
      await h.wait(400);
      const tgt = await page.evaluate(() => {
        const rows = document.querySelectorAll('#panel-root .rw-graph-binding');
        const row = rows[rows.length - 1];
        const sels = row.querySelectorAll('select');
        const b = sels[1].getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      });
      await h.glide(tgt, 20);
      await page.evaluate(([t, a]) => {
        const rows = document.querySelectorAll('#panel-root .rw-graph-binding');
        const row = rows[rows.length - 1];
        const sel = row.querySelectorAll('select')[1];
        sel.value = t;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        const num = row.querySelector('input.rw-num');
        num.value = String(a);
        num.dispatchEvent(new Event('input', { bubbles: true }));
        num.dispatchEvent(new Event('change', { bubbles: true }));
      }, [target, amount]);
      await h.wait(300);
    },
  };
  return g;
}
