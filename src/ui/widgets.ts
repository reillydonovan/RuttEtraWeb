/**
 * Tiny set of reusable form widgets that bind to a key in the SettingsStore.
 * Every widget returns the row element so sections can append it directly.
 *
 * Touch upgrades (gated on `LayoutManager.hasTouch` at runtime):
 *   - slider:   double-tap → reset, long-press → numeric modal,
 *               vertical-distance scrub for fine adjustment
 *   - dropdown: replaces native open with `BottomSheetPicker` in compact mode
 *   - keyboard equivalents preserved (range arrow keys; Backspace on focus
 *     resets to default)
 */

import { animateToggle } from './motion';
import { Settings, SettingsStore, DEFAULTS } from '../state/Settings';
import { clampRangeOverride, isDefaultRange } from '../state/paramRanges';
import { layoutManager } from './layout/LayoutManager';
import { presentSheetPicker } from './widgets/BottomSheetPicker';
import { activeTargetsBus, TargetActivity } from '../modulation/ActiveTargetsBus';
import { registerDesignedRange } from './paramRangeRegistry';
import { attachKeyframeDiamond, setKeyedValueAtPlayhead } from './keyframeAffordance';
import { whenLiveValues } from './liveValueBus';
import { infoButton } from './help/infoModal';
import { groupInfo } from './help/infoContent';
import { attachTooltip } from './tooltip';
import { PARAM_DOCS } from './help/paramDocs';

/**
 * Append a small dual-engine indicator to the row containing `control`.
 * Hidden unless the `paramKey` is being modulated by both engines at
 * once. Half phosphor-green / half amber to read at a glance.
 */
function attachModulationIndicator(control: HTMLElement, paramKey: string): void {
  const dot = document.createElement('span');
  dot.className = 'rw-mod-dot';
  dot.title = 'This param is being modulated by both Classic and Graph engines.';
  dot.setAttribute('aria-hidden', 'true');
  control.appendChild(dot);
  const apply = (a: TargetActivity): void => {
    const both = a.classic && a.graph;
    dot.classList.toggle('on', both);
  };
  // Observation only — bus.subscribe fires immediately with current state.
  activeTargetsBus.subscribe(paramKey, apply);
}

/**
 * Mark `control` as belonging to a Settings key, so `row()` can look up
 * its `PARAM_DOCS` entry and attach a hover tooltip — one call site per
 * widget function (slider/toggle/dropdown/colorInput), reusing the
 * exact key each already threads through to `attachModulationIndicator`
 * / `attachKeyframeDiamond`.
 */
export function markParamKey(control: HTMLElement, paramKey: string): void {
  control.dataset.paramKey = paramKey;
}

export function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const r = document.createElement('div');
  r.className = 'rw-row';
  const l = document.createElement('label');
  l.textContent = label;
  l.className = 'rw-label';
  r.appendChild(l);
  control.classList.add('rw-control');
  r.appendChild(control);
  if (hint) {
    const h = document.createElement('div');
    h.className = 'rw-hint';
    h.textContent = hint;
    r.appendChild(h);
  }
  // Teach-the-panel hover tooltip, sourced from PARAM_DOCS — the same
  // map that drives the in-app Help Controls tab and the About page's
  // Param Reference, so descriptions never drift between surfaces.
  // `control` itself carries the marker for the common case (a widget
  // passed straight to `row()`), but a section may wrap the widget in
  // another container first — e.g. `.rw-inline-group` pairing a slider
  // with a "+ patch an LFO" button (Pattern Generator params) — in
  // which case the marker is on a DESCENDANT, not `control` itself.
  const paramKey = control.dataset.paramKey
    ?? (control.querySelector('[data-param-key]') as HTMLElement | null)?.dataset.paramKey;
  const doc = paramKey ? PARAM_DOCS[paramKey] : undefined;
  if (doc) {
    attachTooltip(r, doc.range ? `${doc.description} (${doc.range})` : doc.description);
  }
  return r;
}

// Old builds remembered open groups; that state is no longer read (groups always start collapsed).
try { localStorage.removeItem('rw-groups-open'); } catch { /* no storage */ }

/** Open every collapsed group that contains `el` (search results, tutorials and tours call this
 *  before scrolling to a control, so a collapsed group never hides what they point at). */
export function expandGroupsAround(el: Element | null): void {
  for (let g = el?.closest('.rw-group') ?? null; g; g = g.parentElement?.closest('.rw-group') ?? null) {
    g.classList.remove('rw-group--collapsed');
  }
}

export function group(title: string): { root: HTMLElement; body: HTMLElement } {
  const root = document.createElement('div');
  root.className = 'rw-group';
  const head = document.createElement('div');
  head.className = 'rw-group-head';
  head.textContent = title;
  head.setAttribute('role', 'button');
  head.tabIndex = 0;
  // Every child group starts collapsed on every load (owner: "by default all controls children
  // should be collapsed"); open state lasts for the session only. `rw-groups-default = open`
  // (set by the video-course recorder) starts them open instead.
  let defaultOpen = false;
  try { defaultOpen = localStorage.getItem('rw-groups-default') === 'open'; } catch { /* no storage */ }
  root.classList.toggle('rw-group--collapsed', !defaultOpen);
  const toggle = (): void => {
    const nowCollapsed = !root.classList.contains('rw-group--collapsed');
    animateToggle(root,
      () => root.classList.toggle('rw-group--collapsed', nowCollapsed),
      () => root.classList.toggle('rw-group--collapsed', !nowCollapsed),
      { caret: '--caret', fromDeg: nowCollapsed ? 0 : -90, toDeg: nowCollapsed ? -90 : 0 });
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  const body = document.createElement('div');
  body.className = 'rw-group-body';
  // ⓘ — what this group is for, plus a reference row for every parameter inside
  // it (read when pressed, so controls added later are included). It sits
  // BESIDE the head, not in it, so the head's text stays exactly the title.
  const info = infoButton(() => {
    const section = root.closest('.rw-section')?.querySelector('.rw-section-head > span')?.textContent?.trim() ?? null;
    const keys = Array.from(root.querySelectorAll<HTMLElement>('[data-param-key]'), (n) => n.dataset.paramKey!);
    return groupInfo(title, section, keys);
  }, `About ${title}`);
  info.classList.add('rw-group-info');
  root.append(head, info, body);
  return { root, body };
}

type NumberKeys = {
  [K in keyof Settings]: Settings[K] extends number ? K : never;
}[keyof Settings];

type BooleanKeys = {
  [K in keyof Settings]: Settings[K] extends boolean ? K : never;
}[keyof Settings];

type StringKeys = {
  [K in keyof Settings]: Settings[K] extends string ? K : never;
}[keyof Settings];

export function slider(
  settings: SettingsStore,
  key: NumberKeys,
  min: number,
  max: number,
  step = 0.01,
): HTMLElement {
  registerDesignedRange(key as string, min, max);
  const wrap = document.createElement('div');
  wrap.className = 'rw-slider';
  const range = document.createElement('input');
  range.type = 'range';
  range.step = String(step);
  const num = document.createElement('input');
  num.type = 'number';
  num.step = String(step);
  num.className = 'rw-num';
  wrap.append(range, num);

  const defaultValue = (DEFAULTS as unknown as Record<string, unknown>)[key as string] as number;

  // v19: effective bounds — the designed (min, max) unless the user has
  // stored a range override for this key. All derived state (stops,
  // scrub mapping, aria, attrs) reads these and is refreshed by
  // applyEffRange() whenever the override changes.
  let effMin = min;
  let effMax = max;

  // Timeline automation offset for this key (namespace 'timeline' in
  // LiveValuesStore). When a lane drives the param, the slider DISPLAYS
  // `base + tlOffset` — the actual value at the playhead. Editing then
  // branches on auto-key rules (Blender/Resolve, Ableton/Pro Tools
  // "write" automation): once the param has at least one lane, every
  // edit is keyed — on an existing point it rewrites that point; off
  // one, it AUTO-CREATES a point at the playhead (setKeyedValueAtPlayhead)
  // rather than editing the base, which would shift the whole curve out
  // from under every other keyframe. Only truly unautomated params (no
  // lane at all) fall through to a plain base edit. Either way what you
  // see and what you set is one number, and modulation still never
  // writes Settings directly (base/live split intact underneath).
  let tlOffset = 0;
  const toDisplay = (base: number): number => base + tlOffset;
  // Continuous drags (native range, scrub bar) collapse into ONE undo
  // step: only the first edit of a gesture snapshots the timeline, the
  // rest pass `snapshot: false`. Every other interaction (typing, stop
  // chips, keyboard, modal, double-click reset) is its own step — see
  // the explicit `fresh: true` call sites below. No-op (no timeline
  // undo stack involved) for unautomated params, which just write
  // `Settings` directly.
  let dragFresh = true;
  const setFromDisplay = (target: number, fresh = dragFresh): void => {
    dragFresh = false;
    if (setKeyedValueAtPlayhead(settings, key as string, target, { snapshot: fresh })) return;
    settings.set(key, (target - tlOffset) as never);
  };
  const endDragGesture = (): void => { dragFresh = true; };

  // Compact-mode stop-chips + tappable readout. Always built and inserted
  // into the DOM; CSS hides them outside compact and hides the native
  // range / number input inside compact. This way a layout flip
  // (`?layout=` override or window resize) is purely a CSS swap with no
  // JS rebuild required.
  let chips: HTMLButtonElement[] = [];
  let stops: number[] = [];
  const stopBar = document.createElement('div');
  stopBar.className = 'rw-slider-stops';
  const rebuildStops = (): void => {
    stops = computeStops(effMin, effMax, step, 5);
    chips = stops.map((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rw-slider-stop';
      b.textContent = formatNum(v, step);
      b.addEventListener('click', () => setFromDisplay(v, true));
      return b;
    });
    stopBar.replaceChildren(...chips);
  };

  const rangeEditFor = (): RangeEditOptions => ({
    defMin: min,
    defMax: max,
    current: { min: effMin, max: effMax },
    onChange: (next) => {
      const cur = { ...(settings.get('paramRangeOverrides') ?? {}) };
      const normalized = next ? clampRangeOverride(min, max, next.min, next.max) : null;
      if (!normalized || isDefaultRange(min, max, normalized)) {
        delete cur[key as string];
      } else {
        cur[key as string] = normalized;
      }
      settings.set('paramRangeOverrides', cur as never);
    },
  });

  const openModal = (): void => {
    openNumericModal(`Enter ${String(key)}`, toDisplay(settings.get(key) as number), effMin, effMax, step, (v) => {
      setFromDisplay(v, true);
    }, rangeEditFor(), wrap.ownerDocument);
  };

  const readoutBtn = document.createElement('button');
  readoutBtn.type = 'button';
  readoutBtn.className = 'rw-slider-readout';
  readoutBtn.addEventListener('click', openModal);

  // Desktop path to the same modal (incl. range editing): right-click.
  wrap.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    openModal();
  });

  // Compact-mode touchable scrub bar — a div, not an <input type="range">.
  // Native range inputs are unreliable inside a `scroll-snap-type: y mandatory`
  // bottom-sheet on iOS Safari (the scroller eats the gesture), so we
  // implement our own pointer-event scrubber that always responds to drag
  // on touch and is identical on mouse. CSS hides it outside compact.
  const scrubBar = document.createElement('div');
  scrubBar.className = 'rw-slider-scrub';
  scrubBar.setAttribute('role', 'slider');
  scrubBar.setAttribute('aria-orientation', 'horizontal');
  scrubBar.setAttribute('aria-label', String(key));
  scrubBar.tabIndex = 0;
  const scrubFill = document.createElement('div');
  scrubFill.className = 'rw-slider-scrub-fill';
  const scrubKnob = document.createElement('div');
  scrubKnob.className = 'rw-slider-scrub-knob';
  scrubBar.append(scrubFill, scrubKnob);

  const decimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
  const snapToStep = (raw: number): number => {
    const snapped = Math.round((raw - effMin) / step) * step + effMin;
    return parseFloat(Math.max(effMin, Math.min(effMax, snapped)).toFixed(decimals + 3));
  };
  const updateFromPointer = (clientX: number): void => {
    const r = scrubBar.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setFromDisplay(snapToStep(effMin + t * (effMax - effMin)));
  };
  // Document-level pointermove/pointerup listeners are more robust on iOS
  // Safari than element-level setPointerCapture: inside the bottom-sheet's
  // scroll-snap container element pointer capture can silently fail and
  // the slider stops responding mid-gesture. Attaching to document on
  // pointerdown and removing on pointerup avoids that entirely.
  let scrubLastTap = 0;
  scrubBar.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    // ownerDocument, not the module-scope document: the panel may live
    // in the popout window (PanelPopout), whose events never reach the
    // main document.
    const doc = scrubBar.ownerDocument;
    const activeId = ev.pointerId;
    // New gesture: the first move below gets the undo snapshot, every
    // subsequent one in this drag collapses into it.
    endDragGesture();
    updateFromPointer(ev.clientX);

    // Double-tap on the scrub bar resets to default — its own step,
    // regardless of the drag gesture the preceding call just started.
    if (ev.pointerType === 'touch') {
      const now = performance.now();
      if (now - scrubLastTap < 320) {
        setFromDisplay(defaultValue, true);
        scrubLastTap = 0;
      } else {
        scrubLastTap = now;
      }
    }

    const onMove = (e: PointerEvent): void => {
      if (e.pointerId !== activeId) return;
      e.preventDefault();
      updateFromPointer(e.clientX);
    };
    const onUp = (e: PointerEvent): void => {
      if (e.pointerId !== activeId) return;
      doc.removeEventListener('pointermove',   onMove);
      doc.removeEventListener('pointerup',     onUp);
      doc.removeEventListener('pointercancel', onUp);
      endDragGesture();
    };
    doc.addEventListener('pointermove',   onMove, { passive: false });
    doc.addEventListener('pointerup',     onUp);
    doc.addEventListener('pointercancel', onUp);
  });
  // Keyboard accessibility — left/right arrows, PageUp/Down, Home/End.
  // Shared by the scrub bar and the hardware-skin knob face below.
  const sliderKeydown = (ev: KeyboardEvent): void => {
    let next = toDisplay(settings.get(key) as number);
    const big = step * 10;
    switch (ev.key) {
      case 'ArrowLeft':  case 'ArrowDown': next -= step; break;
      case 'ArrowRight': case 'ArrowUp':   next += step; break;
      case 'PageDown':                     next -= big;  break;
      case 'PageUp':                       next += big;  break;
      case 'Home':                         next = effMin; break;
      case 'End':                          next = effMax; break;
      case 'Backspace': case 'Delete':     next = defaultValue; break;
      default: return;
    }
    ev.preventDefault();
    setFromDisplay(snapToStep(next), true);
  };
  scrubBar.addEventListener('keydown', sliderKeydown);

  // ----- Hardware-skin knob face (body[data-skin="hardware"]) -----
  // Fifth face of the slider (alongside native range / scrub bar / stop
  // chips / readout), shown only under the hardware skin outside compact
  // layout — skin.css owns the swap, same convention as layout.css. All
  // writes flow through setFromDisplay like every other face, so
  // auto-keying, undo collapsing, and the base/live split hold by
  // construction (skin invariants, PRINCIPLES.md).
  const KNOB_SWEEP = 270; // degrees of pot travel, -135°..+135°, 0° = up
  const svgNS = 'http://www.w3.org/2000/svg';
  const knob = document.createElement('div');
  knob.className = 'rw-knob';
  knob.setAttribute('role', 'slider');
  knob.setAttribute('aria-orientation', 'vertical');
  knob.setAttribute('aria-label', String(key));
  knob.tabIndex = 0;
  const knobArcPath = (r: number): string => {
    const pt = (deg: number): string => {
      const a = (deg * Math.PI) / 180;
      return `${(20 + r * Math.sin(a)).toFixed(3)} ${(20 - r * Math.cos(a)).toFixed(3)}`;
    };
    return `M ${pt(-KNOB_SWEEP / 2)} A ${r} ${r} 0 1 1 ${pt(KNOB_SWEEP / 2)}`;
  };
  const knobSvg = document.createElementNS(svgNS, 'svg');
  knobSvg.setAttribute('viewBox', '0 0 40 40');
  knobSvg.setAttribute('class', 'rw-knob-svg');
  const knobTrack = document.createElementNS(svgNS, 'path');
  knobTrack.setAttribute('d', knobArcPath(17));
  knobTrack.setAttribute('class', 'rw-knob-track');
  const knobFill = document.createElementNS(svgNS, 'path');
  knobFill.setAttribute('d', knobArcPath(17));
  knobFill.setAttribute('pathLength', String(KNOB_SWEEP));
  knobFill.setAttribute('stroke-dasharray', `0 ${KNOB_SWEEP}`);
  knobFill.setAttribute('class', 'rw-knob-fill');
  const knobCap = document.createElementNS(svgNS, 'circle');
  knobCap.setAttribute('cx', '20');
  knobCap.setAttribute('cy', '20');
  knobCap.setAttribute('r', '13');
  knobCap.setAttribute('class', 'rw-knob-cap');
  const knobPtr = document.createElementNS(svgNS, 'line');
  knobPtr.setAttribute('x1', '20');
  knobPtr.setAttribute('y1', '20');
  knobPtr.setAttribute('x2', '20');
  knobPtr.setAttribute('y2', '9');
  knobPtr.setAttribute('class', 'rw-knob-ptr');
  knobSvg.append(knobTrack, knobFill, knobCap, knobPtr);
  knob.appendChild(knobSvg);

  // Vertical pointer scrub: the full effective range over ~160px of
  // travel, Shift = fine (×0.1). Same document-level listener pattern
  // (and popout-safe ownerDocument) as the compact scrub bar above.
  knob.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    const doc = knob.ownerDocument;
    const activeId = ev.pointerId;
    const startY = ev.clientY;
    const startVal = toDisplay(settings.get(key) as number);
    endDragGesture();
    const onMove = (e: PointerEvent): void => {
      if (e.pointerId !== activeId) return;
      e.preventDefault();
      const fine = e.shiftKey ? 0.1 : 1;
      const span = effMax - effMin;
      setFromDisplay(snapToStep(startVal + ((startY - e.clientY) / 160) * span * fine));
    };
    const onUp = (e: PointerEvent): void => {
      if (e.pointerId !== activeId) return;
      doc.removeEventListener('pointermove',   onMove);
      doc.removeEventListener('pointerup',     onUp);
      doc.removeEventListener('pointercancel', onUp);
      endDragGesture();
    };
    doc.addEventListener('pointermove',   onMove, { passive: false });
    doc.addEventListener('pointerup',     onUp);
    doc.addEventListener('pointercancel', onUp);
  });
  knob.addEventListener('dblclick', () => setFromDisplay(defaultValue, true));
  knob.addEventListener('keydown', sliderKeydown);

  wrap.append(scrubBar, stopBar, readoutBtn, knob);

  const apply = (base: number) => {
    // What the slider SHOWS is the value at the playhead: base plus the
    // timeline lane's offset (identical to base when no lane drives it).
    const v = toDisplay(base);
    wrap.classList.toggle('rw-slider--tl', tlOffset !== 0);
    range.value = String(v);
    // Never rewrite the number field while someone is typing in it: each
    // keystroke writes the value, and reformatting "1." back to "1" mid-entry
    // made decimals impossible to type. It is reformatted on blur instead.
    if (num.ownerDocument.activeElement !== num) num.value = formatNum(v, step);
    readoutBtn.textContent = formatNum(v, step);
    const t = effMax === effMin ? 0 : (v - effMin) / (effMax - effMin);
    const pct = Math.max(0, Math.min(1, t)) * 100;
    scrubFill.style.width = `${pct}%`;
    scrubKnob.style.left = `${pct}%`;
    scrubBar.setAttribute('aria-valuenow', String(v));
    scrubBar.setAttribute('aria-valuetext', formatNum(v, step));
    // Hardware-skin knob: pointer angle + fill arc track the same
    // clamped 0..1 position as the scrub bar. Cheap enough to update
    // unconditionally — no need to branch on the active skin.
    const knobAngle = -KNOB_SWEEP / 2 + (pct / 100) * KNOB_SWEEP;
    knobPtr.setAttribute('transform', `rotate(${knobAngle.toFixed(2)} 20 20)`);
    knobFill.setAttribute('stroke-dasharray', `${((pct / 100) * KNOB_SWEEP).toFixed(2)} ${KNOB_SWEEP}`);
    knob.setAttribute('aria-valuenow', String(v));
    knob.setAttribute('aria-valuetext', formatNum(v, step));
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < stops.length; i++) {
      const d = Math.abs(stops[i] - v);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    chips.forEach((c, i) => c.classList.toggle('selected', i === best));
  };

  // v19: apply the effective bounds to every derived control. Runs once
  // at build and again whenever the override map changes (including on
  // preset / project load, since those write Settings keys).
  const applyEffRange = (): void => {
    const o = (settings.get('paramRangeOverrides') ?? {})[key as string];
    const normalized = o ? clampRangeOverride(min, max, o.min, o.max) : null;
    effMin = normalized?.min ?? min;
    effMax = normalized?.max ?? max;
    range.min = String(effMin); range.max = String(effMax);
    num.min = String(effMin);   num.max = String(effMax);
    scrubBar.setAttribute('aria-valuemin', String(effMin));
    scrubBar.setAttribute('aria-valuemax', String(effMax));
    knob.setAttribute('aria-valuemin', String(effMin));
    knob.setAttribute('aria-valuemax', String(effMax));
    wrap.classList.toggle('rw-slider--custom-range', normalized != null);
    rebuildStops();
    apply(settings.get(key) as number);
  };
  settings.subscribe('paramRangeOverrides', () => applyEffRange());

  settings.subscribe(key, (v) => apply(v as number));

  // Gesture boundaries for the native range: a mouse/touch drag fires
  // many 'input' events between these two, so only the first collapses
  // into an undo step (see setFromDisplay/dragFresh above). A keyboard
  // nudge (arrow keys) fires 'input' with no preceding pointerdown, so
  // it naturally starts fresh and is its own step.
  range.addEventListener('pointerdown', endDragGesture);
  range.addEventListener('pointerup', endDragGesture);
  range.addEventListener('pointercancel', endDragGesture);
  range.addEventListener('input', () => setFromDisplay(+range.value));
  num.addEventListener('input', () => {
    const v = parseFloat(num.value);
    if (!Number.isNaN(v)) setFromDisplay(v, true);
  });
  num.addEventListener('blur', () => apply(settings.get(key) as number));
  num.addEventListener('keydown', (e) => { if (e.key === 'Enter') num.blur(); });

  attachModulationIndicator(wrap, key as string);
  markParamKey(wrap, key as string);
  // Keyframing v2: inline ◆ — keyframe this param at the playhead.
  // No-op for keys that aren't modulation targets; hidden until a
  // timeline exists.
  attachKeyframeDiamond(wrap, key as string, settings);

  // Discoverable range clamp (owner request): the v19 custom-range
  // editor has only ever been reachable via right-click, which nobody
  // finds. A small always-visible ▾ opens a mini-menu exposing the SAME
  // modal (reuse, not a fork) plus quick reset actions.
  const rangeBtn = document.createElement('button');
  rangeBtn.type = 'button';
  rangeBtn.className = 'rw-range-menu-btn';
  rangeBtn.textContent = '▾';
  attachTooltip(rangeBtn, 'Value & range menu — set a custom min/max clamp for this slider.');
  rangeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const doc = rangeBtn.ownerDocument;
    doc.getElementById('rw-range-menu')?.remove();
    const ul = doc.createElement('ul');
    ul.id = 'rw-range-menu';
    ul.className = 'rw-kf-menu'; // same CRT popover recipe as the ◆ menu
    const r = rangeBtn.getBoundingClientRect();
    ul.style.left = `${r.left}px`;
    ul.style.top = `${r.bottom + 4}px`;
    const item = (label: string, disabled: boolean, onClick?: () => void): void => {
      const li = doc.createElement('li');
      li.textContent = label;
      if (disabled) li.classList.add('disabled');
      else li.addEventListener('click', () => { onClick?.(); ul.remove(); });
      ul.appendChild(li);
    };
    const hasOverride = (settings.get('paramRangeOverrides') ?? {})[key as string] != null;
    item('Set range / exact value…', false, openModal);
    item('Reset range to stock', !hasOverride, () => {
      const cur = { ...(settings.get('paramRangeOverrides') ?? {}) };
      delete cur[key as string];
      settings.set('paramRangeOverrides', cur as never);
    });
    item(`Reset value to default (${formatNum(defaultValue, step)})`, false, () => setFromDisplay(defaultValue, true));
    doc.body.appendChild(ul);
    const close = (e: Event): void => {
      if (e.target instanceof Node && ul.contains(e.target)) return;
      ul.remove();
      doc.removeEventListener('pointerdown', close, true);
    };
    doc.addEventListener('pointerdown', close, true);
  });
  wrap.appendChild(rangeBtn);

  // Timeline-driven display + live-modulation badge.
  //
  // The 'timeline' namespace offset folds INTO the slider's displayed
  // value (one number: the value at the playhead — see toDisplay /
  // setFromDisplay above). The amber ▸ badge only appears for the
  // remaining modulation on top of that (Classic LFOs, Graph, CV…),
  // which wobbles at audio/frame rate and can't be folded into an
  // editable knob. Display only — never written back into Settings.
  const liveBadge = document.createElement('span');
  liveBadge.className = 'rw-live-badge';
  liveBadge.title = 'Live value (with LFO/CV/graph modulation on top).';
  liveBadge.hidden = true;
  wrap.appendChild(liveBadge);
  let lastBadgeText = '';
  whenLiveValues((lv) => {
    lv.subscribe(key as string, (liveV) => {
      const prevTl = tlOffset;
      tlOffset = lv.getNamespaceOffset('timeline', key as string);
      const base = settings.get(key) as number;
      if (tlOffset !== prevTl) apply(base);
      // Badge: modulation beyond what the knob already displays.
      const modded = Math.abs(liveV - toDisplay(base)) > 1e-6;
      liveBadge.hidden = !modded;
      wrap.closest('.rw-row')?.classList.toggle('rw-row--live', modded);
      if (!modded) return;
      const txt = `▸ ${formatNum(liveV, step)}`;
      if (txt !== lastBadgeText) {
        liveBadge.textContent = txt;
        lastBadgeText = txt;
      }
    });
  });

  // ----- Touch upgrades -----
  // Double-click / double-tap → reset to default. Keyboard equivalent:
  // Backspace/Delete on a focused range. Native horizontal drag continues
  // to fire `input` events untouched.
  range.addEventListener('dblclick', () => setFromDisplay(defaultValue, true));
  range.addEventListener('keydown', (ev) => {
    if (ev.key === 'Backspace' || ev.key === 'Delete') {
      ev.preventDefault();
      setFromDisplay(defaultValue, true);
    }
  });

  // Detect double-tap reset on touch — separate from any other touch handler
  // and never preventDefault, so native slider drag still works.
  if (layoutManager().hasTouch) {
    let lastTapAt = 0;
    let lastTapX = 0, lastTapY = 0;
    range.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'touch') return;
      const now = performance.now();
      const dx = ev.clientX - lastTapX;
      const dy = ev.clientY - lastTapY;
      if (now - lastTapAt < 320 && Math.hypot(dx, dy) < 20) {
        setFromDisplay(defaultValue, true);
        lastTapAt = 0;
      } else {
        lastTapAt = now;
        lastTapX = ev.clientX;
        lastTapY = ev.clientY;
      }
    });

    // Long-press → numeric input modal. Cancelled if the finger moves
    // more than a few px (i.e. the user is dragging the slider, not
    // requesting precise entry).
    let pressTimer: number | null = null;
    let pressStartX = 0, pressStartY = 0;
    const cancelLongPress = () => {
      if (pressTimer != null) { clearTimeout(pressTimer); pressTimer = null; }
    };
    const onMove = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - pressStartX, e.clientY - pressStartY) > 6) cancelLongPress();
    };
    range.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'touch') return;
      cancelLongPress();
      pressStartX = ev.clientX; pressStartY = ev.clientY;
      pressTimer = window.setTimeout(() => {
        pressTimer = null;
        openModal();
      }, 700);
      range.addEventListener('pointermove', onMove);
      const stop = () => {
        cancelLongPress();
        range.removeEventListener('pointermove', onMove);
      };
      range.addEventListener('pointerup',     stop, { once: true });
      range.addEventListener('pointercancel', stop, { once: true });
      range.addEventListener('pointerleave',  stop, { once: true });
    });
  }

  return wrap;
}

function clampNumber(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** v19: optional range-editing section on the numeric modal. Exported
 *  so any other surface with its own numeric control (the Patch Bay's
 *  `addParamCell`, currently) can open the SAME modal instead of
 *  forking a second range-editing UI — one authoritative "set range"
 *  experience app-wide, per principle 1. */
export interface RangeEditOptions {
  /** Designed bounds — the "Reset range" target and clamp reference. */
  defMin: number;
  defMax: number;
  /** Effective bounds when the modal opened. */
  current: { min: number; max: number };
  /** null = reset to designed bounds; otherwise the requested override. */
  onChange(next: { min: number; max: number } | null): void;
}

export function openNumericModal(
  title: string, current: number, min: number, max: number, step: number,
  onAccept: (v: number) => void,
  rangeEdit?: RangeEditOptions,
  hostDoc: Document = document,
): void {
  const overlay = document.createElement('div');
  overlay.className = 'rw-numeric-modal';
  const card = document.createElement('div');
  card.className = 'rw-numeric-modal-card';
  const t = document.createElement('div');
  t.className = 'rw-numeric-modal-title';
  t.textContent = title;
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.min = String(min); inp.max = String(max); inp.step = String(step);
  inp.value = String(current);
  inp.inputMode = 'decimal';
  const row = document.createElement('div');
  row.className = 'rw-numeric-modal-row';
  const cancel = document.createElement('button');
  cancel.className = 'rw-btn'; cancel.type = 'button'; cancel.textContent = 'Cancel';
  const ok = document.createElement('button');
  ok.className = 'rw-btn primary'; ok.type = 'button'; ok.textContent = 'OK';
  row.append(cancel, ok);
  card.append(t, inp);

  // Optional custom-range editor. The value clamp on OK uses whatever
  // bounds are in these fields, so widening the range and typing a value
  // beyond the old bounds works in a single visit.
  let rangeMinInp: HTMLInputElement | null = null;
  let rangeMaxInp: HTMLInputElement | null = null;
  if (rangeEdit) {
    const sub = document.createElement('div');
    sub.className = 'rw-numeric-modal-subtitle';
    sub.textContent = `Custom range (stock ${rangeEdit.defMin}..${rangeEdit.defMax})`;
    rangeMinInp = document.createElement('input');
    rangeMinInp.type = 'number'; rangeMinInp.inputMode = 'decimal';
    rangeMinInp.value = String(rangeEdit.current.min);
    rangeMinInp.title = 'Slider minimum';
    rangeMaxInp = document.createElement('input');
    rangeMaxInp.type = 'number'; rangeMaxInp.inputMode = 'decimal';
    rangeMaxInp.value = String(rangeEdit.current.max);
    rangeMaxInp.title = 'Slider maximum';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'rw-btn'; resetBtn.type = 'button'; resetBtn.textContent = 'Reset range';
    resetBtn.addEventListener('click', () => {
      rangeMinInp!.value = String(rangeEdit.defMin);
      rangeMaxInp!.value = String(rangeEdit.defMax);
    });
    const rangeRow = document.createElement('div');
    rangeRow.className = 'rw-numeric-modal-range';
    rangeRow.append(rangeMinInp, rangeMaxInp, resetBtn);
    card.append(sub, rangeRow);
  }

  card.append(row);
  overlay.append(card);
  // Appending auto-adopts into the host document (popout-safe).
  hostDoc.body.appendChild(overlay);
  inp.focus(); inp.select();
  const close = () => overlay.remove();
  cancel.addEventListener('click', close);
  ok.addEventListener('click', () => {
    let lo = min, hi = max;
    if (rangeEdit && rangeMinInp && rangeMaxInp) {
      const wantMin = parseFloat(rangeMinInp.value);
      const wantMax = parseFloat(rangeMaxInp.value);
      const changed = wantMin !== rangeEdit.current.min || wantMax !== rangeEdit.current.max;
      if (changed) {
        const isReset = wantMin === rangeEdit.defMin && wantMax === rangeEdit.defMax;
        rangeEdit.onChange(isReset ? null : { min: wantMin, max: wantMax });
      }
      if (Number.isFinite(wantMin) && Number.isFinite(wantMax) && wantMax > wantMin) {
        lo = wantMin; hi = wantMax;
      }
    }
    const v = parseFloat(inp.value);
    if (Number.isFinite(v)) onAccept(clampNumber(v, lo, hi));
    close();
  });
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') ok.click();
    if (ev.key === 'Escape') cancel.click();
  });
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) cancel.click(); });
}

export function toggle(settings: SettingsStore, key: BooleanKeys, label = ''): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'rw-toggle';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  const sw = document.createElement('span');
  sw.className = 'rw-toggle-sw';
  const txt = document.createElement('span');
  txt.className = 'rw-toggle-txt';
  txt.textContent = label;
  wrap.append(cb, sw, txt);

  settings.subscribe(key, (v) => { cb.checked = !!v; });
  cb.addEventListener('change', () => settings.set(key, cb.checked as any));
  attachModulationIndicator(wrap, key as string);
  markParamKey(wrap, key as string);
  return wrap;
}

export function dropdown<K extends keyof Settings>(
  settings: SettingsStore,
  key: K,
  options: { value: Settings[K]; label: string }[],
): HTMLElement {
  const sel = document.createElement('select');
  sel.className = 'rw-select';
  markParamKey(sel, key as string);
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = String(o.value);
    opt.textContent = o.label;
    sel.appendChild(opt);
  }
  settings.subscribe(key, (v) => { sel.value = String(v); });
  sel.addEventListener('change', () => {
    const raw = sel.value;
    const found = options.find((o) => String(o.value) === raw);
    if (found) settings.set(key, found.value);
  });

  // Compact + touch: intercept the native open and use a bottom-sheet picker.
  const intercept = (ev: Event) => {
    const layout = layoutManager();
    if (layout.current() !== 'compact' || !layout.hasTouch) return;
    ev.preventDefault();
    presentSheetPicker({
      title: String(key),
      options: options.map((o) => ({ value: String(o.value), label: o.label })),
      selected: String(settings.get(key)),
      onPick: (v) => {
        const found = options.find((o) => String(o.value) === v);
        if (found) settings.set(key, found.value);
      },
    });
  };
  sel.addEventListener('mousedown',   intercept);
  sel.addEventListener('touchstart',  intercept, { passive: false });

  return sel;
}

export function colorInput(settings: SettingsStore, key: StringKeys): HTMLElement {
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.className = 'rw-color';
  markParamKey(inp, key as string);
  settings.subscribe(key, (v) => { inp.value = v as string; });
  inp.addEventListener('input', () => settings.set(key, inp.value as any));
  return inp;
}

export function button(label: string, onClick: () => void, variant = ''): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `rw-btn ${variant}`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export function textInput(value: string, placeholder = ''): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'text';
  i.value = value;
  i.placeholder = placeholder;
  i.className = 'rw-text';
  return i;
}

export function readout(): HTMLElement {
  const d = document.createElement('div');
  d.className = 'rw-readout';
  return d;
}

/**
 * Unity/Blender-style "click to type, drag to scrub" behavior for a
 * plain `<input type="number">` that isn't a Settings-bound slider (the
 * timeline transport's BPM/LENGTH/B-BAR fields, for instance). Reuses
 * the vertical-scrub convention the hardware knob already uses
 * (up = increase, Shift = fine ×0.1), but layered on TOP of the
 * input's normal click-to-focus/type behavior rather than replacing
 * it: a plain click still focuses and lets you type; only a drag past
 * a small threshold takes over as a scrub, at which point the input is
 * blurred (no blinking caret/selection fighting the drag) and a single
 * synthetic `change` fires at release so existing `change` listeners
 * apply the final value exactly once (not on every pixel of movement).
 */
export function attachNumberDragScrub(input: HTMLInputElement, getStep: () => number): void {
  const THRESHOLD = 4;
  input.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const doc = input.ownerDocument;
    const startY = ev.clientY;
    const startVal = parseFloat(input.value) || 0;
    let dragging = false;
    const onMove = (e: PointerEvent): void => {
      const dy = startY - e.clientY; // up = increase
      if (!dragging) {
        if (Math.abs(dy) < THRESHOLD) return;
        dragging = true;
        input.blur();
        doc.body.classList.add('rw-num-scrubbing');
      }
      e.preventDefault();
      const step = getStep() || 1;
      const fine = e.shiftKey ? 0.1 : 1;
      const next = startVal + Math.round((dy - Math.sign(dy) * THRESHOLD) / 4) * step * fine;
      input.value = String(next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const onUp = (): void => {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onUp);
      doc.body.classList.remove('rw-num-scrubbing');
      if (dragging) input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
    doc.addEventListener('pointercancel', onUp);
  });
}

/**
 * Custom stepper buttons for a plain `<input type="number">`, standing
 * in for the browser's native spin-button arrows (suppressed app-wide
 * in panel.css — they render as an unstyled grey OS control that can't
 * be reskinned, only hidden: `::-webkit-inner/outer-spin-button` isn't
 * restylable into a custom glyph). Owner: "there should be stepper
 * arrows just stylized to fit the aesthetic of the design system" — a
 * correction to simply removing them; this restores the up/down click
 * affordance as a real, on-theme pair of buttons instead.
 *
 * Reads `min`/`max`/`step` off the input's own attributes (every
 * current call site already sets them) rather than taking them as
 * options — one source, no risk of the two drifting apart. Returns a
 * wrapper `<span>` containing the (untouched, still focusable/typeable)
 * input plus the button pair; the caller inserts the WRAPPER in the
 * input's original place.
 *
 * Click steps once; press-and-hold repeats after a short delay, same
 * feel as a native spinner. Every step dispatches a real `input` event
 * (and `change` on release) so whatever listener the caller already
 * attached to `input` keeps working unmodified — this only adds a
 * second way to drive the same element, never a parallel value path.
 */
export function attachNumberStepper(input: HTMLInputElement): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'rw-num-stepper';
  wrap.appendChild(input);

  const btns = document.createElement('span');
  btns.className = 'rw-num-stepper-btns';
  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'rw-num-stepper-btn rw-num-stepper-up';
  up.tabIndex = -1;
  up.setAttribute('aria-label', 'Increment');
  const down = document.createElement('button');
  down.type = 'button';
  down.className = 'rw-num-stepper-btn rw-num-stepper-down';
  down.tabIndex = -1;
  down.setAttribute('aria-label', 'Decrement');
  btns.append(up, down);
  wrap.appendChild(btns);

  const bump = (dir: 1 | -1): void => {
    const step = parseFloat(input.step) || 1;
    const min = input.min !== '' ? parseFloat(input.min) : -Infinity;
    const max = input.max !== '' ? parseFloat(input.max) : Infinity;
    const cur = parseFloat(input.value) || 0;
    const next = Math.min(max, Math.max(min, cur + dir * step));
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const HOLD_DELAY_MS = 400;
  const REPEAT_MS = 60;
  const wireHold = (btn: HTMLButtonElement, dir: 1 | -1): void => {
    let delay: ReturnType<typeof setTimeout> | null = null;
    let repeat: ReturnType<typeof setInterval> | null = null;
    const stop = (): void => {
      if (delay) clearTimeout(delay);
      if (repeat) clearInterval(repeat);
      delay = null; repeat = null;
    };
    btn.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault(); // don't steal focus/selection from the input
      bump(dir);
      delay = setTimeout(() => { repeat = setInterval(() => bump(dir), REPEAT_MS); }, HOLD_DELAY_MS);
    });
    const release = (): void => {
      stop();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('pointercancel', release);
  };
  wireHold(up, 1);
  wireHold(down, -1);

  return wrap;
}

/**
 * Generic (non-Settings-bound) hardware-skin knob face, for a plain
 * `{ get, set, min, max, step }` value — the same lightweight binding
 * model `createMiniKnob` (`patchbay/miniKnob.ts`) already uses for the
 * Patch Bay's jack cells, sized instead for a normal Controls-panel row
 * (the `.rw-knob`/`.rw-knob-svg`/`.rw-knob-track`/`.rw-knob-fill`/
 * `.rw-knob-cap`/`.rw-knob-ptr` classes `slider()`'s own knob face uses
 * above in this file, at their real 44px size — NOT the Patch Bay's
 * compact `.rw-pbknob*` classes, which would read as visually
 * undersized next to every other knob in the same panel).
 *
 * Exists because `SlotRow.ts`'s hand-rolled fields (the Classic/Graph
 * Beginner expandable rows' Amount slider, and every per-source-type
 * param — LFO rate, Audio Band/Gain, Ramp phase, ...) only ever built a
 * bare `<input type="range">` + `.rw-num` pair inside a `.rw-slider`
 * wrapper. That's invisible under the hardware/rack skin: skin.css's
 * `.rw-slider input[type="range"], .rw-slider .rw-num { display: none }`
 * rule assumes EVERY `.rw-slider` has a matching `.rw-knob` face to
 * show instead (the only face `slider()` itself ever builds) — a field
 * with no knob at all just renders as an empty row (owner screenshot:
 * the Beginner view's AMT slider, and Band/Gain, both blank under HW).
 * `slider()`'s own knob-building code isn't reused directly because
 * it's deeply coupled to Settings-specific concerns (range overrides,
 * timeline auto-key, `toDisplay`) that none of these callers have —
 * same "lighter cousin, not a fork of the heavy one" reasoning
 * `createMiniKnob`'s own doc comment already gives for why IT exists
 * as a separate copy rather than reusing `slider()`'s version either.
 */
export interface RawKnobOpts {
  get(): number;
  set(v: number): void;
  min: number;
  max: number;
  step: number;
  ariaLabel: string;
}

export interface RawKnob {
  el: HTMLElement;
  /** Re-read `get()` and update the pointer/fill. Cheap no-op when the
   *  value hasn't changed since the last call. */
  refresh(): void;
}

const RAW_KNOB_SWEEP = 270; // degrees of pot travel, -135°..+135°, 0° = up

function rawKnobArcPath(r: number): string {
  const pt = (deg: number): string => {
    const a = (deg * Math.PI) / 180;
    return `${(20 + r * Math.sin(a)).toFixed(3)} ${(20 - r * Math.cos(a)).toFixed(3)}`;
  };
  return `M ${pt(-RAW_KNOB_SWEEP / 2)} A ${r} ${r} 0 1 1 ${pt(RAW_KNOB_SWEEP / 2)}`;
}

export function createRawKnob(opts: RawKnobOpts): RawKnob {
  const svgNS = 'http://www.w3.org/2000/svg';
  const el = document.createElement('div');
  el.className = 'rw-knob';
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-orientation', 'vertical');
  el.setAttribute('aria-label', opts.ariaLabel);
  el.tabIndex = 0;

  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('class', 'rw-knob-svg');
  const track = document.createElementNS(svgNS, 'path');
  track.setAttribute('d', rawKnobArcPath(17));
  track.setAttribute('class', 'rw-knob-track');
  const fill = document.createElementNS(svgNS, 'path');
  fill.setAttribute('d', rawKnobArcPath(17));
  fill.setAttribute('pathLength', String(RAW_KNOB_SWEEP));
  fill.setAttribute('stroke-dasharray', `0 ${RAW_KNOB_SWEEP}`);
  fill.setAttribute('class', 'rw-knob-fill');
  const cap = document.createElementNS(svgNS, 'circle');
  cap.setAttribute('cx', '20'); cap.setAttribute('cy', '20'); cap.setAttribute('r', '13');
  cap.setAttribute('class', 'rw-knob-cap');
  const ptr = document.createElementNS(svgNS, 'line');
  ptr.setAttribute('x1', '20'); ptr.setAttribute('y1', '20');
  ptr.setAttribute('x2', '20'); ptr.setAttribute('y2', '9');
  ptr.setAttribute('class', 'rw-knob-ptr');
  svg.append(track, fill, cap, ptr);
  el.appendChild(svg);

  const clamp = (v: number): number => Math.min(opts.max, Math.max(opts.min, v));
  const snap = (v: number): number => (opts.step > 0 ? Math.round(v / opts.step) * opts.step : v);
  const angleFor = (v: number): number => {
    const span = opts.max - opts.min;
    const t = span === 0 ? 0 : Math.min(1, Math.max(0, (v - opts.min) / span));
    return -RAW_KNOB_SWEEP / 2 + t * RAW_KNOB_SWEEP;
  };

  let lastShown = Number.NaN;
  function refresh(): void {
    const v = opts.get();
    if (Object.is(v, lastShown)) return;
    lastShown = v;
    const a = angleFor(v);
    ptr.setAttribute('transform', `rotate(${a.toFixed(2)} 20 20)`);
    const t = (a + RAW_KNOB_SWEEP / 2) / RAW_KNOB_SWEEP;
    fill.setAttribute('stroke-dasharray', `${(t * RAW_KNOB_SWEEP).toFixed(2)} ${RAW_KNOB_SWEEP}`);
    el.setAttribute('aria-valuenow', String(v));
  }

  el.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    const doc = el.ownerDocument;
    const id = ev.pointerId;
    const startY = ev.clientY;
    const startVal = opts.get();
    const onMove = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      e.preventDefault();
      const fine = e.shiftKey ? 0.1 : 1;
      const span = opts.max - opts.min;
      opts.set(clamp(snap(startVal + ((startY - e.clientY) / 160) * span * fine)));
      refresh();
    };
    const onUp = (e: PointerEvent): void => {
      if (e.pointerId !== id) return;
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onUp);
    };
    doc.addEventListener('pointermove', onMove, { passive: false });
    doc.addEventListener('pointerup', onUp);
    doc.addEventListener('pointercancel', onUp);
  });
  el.addEventListener('keydown', (ev) => {
    let v = opts.get();
    switch (ev.key) {
      case 'ArrowUp': case 'ArrowRight': v += opts.step; break;
      case 'ArrowDown': case 'ArrowLeft': v -= opts.step; break;
      case 'PageUp': v += opts.step * 10; break;
      case 'PageDown': v -= opts.step * 10; break;
      case 'Home': v = opts.min; break;
      case 'End': v = opts.max; break;
      default: return;
    }
    ev.preventDefault();
    opts.set(clamp(snap(v)));
    refresh();
  });

  refresh();
  return { el, refresh };
}

function formatNum(v: number, step: number): string {
  if (step >= 1) return String(Math.round(v));
  if (step >= 0.1) return v.toFixed(2);
  return v.toFixed(3);
}

/**
 * Generates `n` evenly-spaced "stop" values between `min` and `max`,
 * snapped to the slider's step grid. Used to drive the compact-mode
 * stop-chip strip in place of the native range slider.
 */
function computeStops(min: number, max: number, step: number, n: number): number[] {
  const out: number[] = [];
  const stepDecimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const raw = min + (max - min) * t;
    const snapped = Math.round((raw - min) / step) * step + min;
    out.push(parseFloat(snapped.toFixed(stepDecimals + 3)));
  }
  return out;
}
