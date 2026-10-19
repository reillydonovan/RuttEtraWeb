/**
 * Inline keyframe diamond (◆) on panel parameter rows — the "create/see"
 * half of the hybrid keyframing model. Clicking keys the param at the
 * playhead; the lane editor in the timeline dock is where shaping
 * happens. Decision logic lives in `keyframeState.ts` (pure, tested);
 * this module is the DOM shell plus a lazily-registered dependency
 * bus, because slider() runs at panel-build time while the Sequencer
 * and dock arrive from dynamic imports.
 *
 * States: hidden (no timeline) → hollow dim ◇ (keyable) → outline ◇
 * (lane exists) → filled ◆ (point exactly at the playhead).
 *
 * Multi-lane convention (documented in keyframeState.ts): state shows
 * 'point' if ANY lane for the key has one at the head; the click toggle
 * operates on the FIRST lane; "Remove automation" in the context menu
 * deletes ALL lanes for the key.
 *
 * Popout-safe: menus are created in the control's ownerDocument, since
 * panel sections can live in the two-screen popout window.
 */

import type { Sequencer } from '../sequencer/Sequencer';
import { AutomationLane, newLaneId } from '../sequencer/types';
import { upsertPoint, removePointAt, evalLane } from '../sequencer/lanes';
import { SettingsStore } from '../state/Settings';
import { TARGETS } from './targets';
import { diamondState, planToggle } from './keyframeState';
import { findPointAt } from './timeline/laneGeometry';

const TARGET_KEYS = new Set<string>(TARGETS.map((t) => t.v as string));
const PLAYHEAD_THROTTLE_MS = 100;
const LONG_PRESS_MS = 700;

interface DockActions {
  revealLane(laneId: string): void;
}

interface DiamondEntry {
  key: string;
  btn: HTMLButtonElement;
  /** Resolve-style prev/next keyframe jump arrows flanking the diamond.
   *  Only visible while the param carries at least one lane. */
  prevBtn: HTMLButtonElement;
  nextBtn: HTMLButtonElement;
  /** True once the button has been seen in a document — pruning only
   *  applies to previously-mounted buttons, not ones still waiting for
   *  their panel section to be appended during boot. */
  everConnected: boolean;
}

let seq: Sequencer | null = null;
let dockActions: DockActions | null = null;
const diamonds: DiamondEntry[] = [];
/** paramKey → its lanes in the current timeline (rebuilt on every change). */
const laneIndex = new Map<string, AutomationLane[]>();
let lastHeadUpdate = 0;

function rebuildIndex(): void {
  laneIndex.clear();
  const lanes = seq?.timeline?.lanes ?? [];
  for (const lane of lanes) {
    const list = laneIndex.get(lane.paramKey);
    if (list) list.push(lane);
    else laneIndex.set(lane.paramKey, [lane]);
  }
}

function updateAll(): void {
  // Prune diamonds whose rows were rebuilt away (pattern-section params
  // re-render on kind change) so the registry can't grow unbounded.
  for (let i = diamonds.length - 1; i >= 0; i--) {
    const d = diamonds[i];
    if (d.btn.isConnected) d.everConnected = true;
    else if (d.everConnected) diamonds.splice(i, 1);
  }
  const hasTimeline = !!seq?.timeline;
  const head = seq?.playheadBar ?? 0;
  for (const { key, btn, prevBtn, nextBtn } of diamonds) {
    btn.hidden = !hasTimeline;
    const keyLanes = laneIndex.get(key) ?? [];
    const state = hasTimeline ? diamondState(keyLanes, head) : 'none';
    btn.classList.toggle('rw-kf-lane', state === 'lane');
    btn.classList.toggle('rw-kf-point', state === 'point');
    btn.textContent = state === 'point' ? '◆' : '◇';
    btn.title = state === 'point'
      ? 'Keyed at the playhead — click to remove this point'
      : state === 'lane'
        ? 'Automated — click to add a point at the playhead'
        : 'Click to keyframe this param at the playhead';
    // Jump arrows only make sense once the param has keyframes to visit.
    const bars = keyBars(key);
    const eps = 1e-6;
    prevBtn.hidden = nextBtn.hidden = !hasTimeline || bars.length === 0;
    prevBtn.disabled = !bars.some((b) => b < head - eps);
    nextBtn.disabled = !bars.some((b) => b > head + eps);
    // Row marker so the panel shows which params carry automation.
    const rowEl = btn.closest('.rw-row');
    rowEl?.classList.toggle('rw-row--animated', keyLanes.length > 0);
    // Keyable rows get extra top padding so the ◆ strip above the slider
    // has real vertical room instead of overlapping the row above.
    rowEl?.classList.toggle('rw-row--keyable', hasTimeline);
  }
}

/** Sorted bars of every point across the key's lanes. */
function keyBars(key: string): number[] {
  return (laneIndex.get(key) ?? [])
    .flatMap((l) => l.points.map((p) => p.bar))
    .sort((a, b) => a - b);
}

/** Seek the playhead to this param's previous/next keyframe. */
function jumpParamKeyframe(key: string, dir: -1 | 1): void {
  if (!seq?.timeline) return;
  const bars = keyBars(key);
  const eps = 1e-6;
  const head = seq.playheadBar;
  const target = dir > 0
    ? bars.find((b) => b > head + eps)
    : [...bars].reverse().find((b) => b < head - eps);
  if (target !== undefined) seq.seek(target);
}

/** Wire the eagerly-created Sequencer. Called once from main.ts. */
export function registerSequencer(s: Sequencer): void {
  seq = s;
  s.addTimelineListener(() => {
    rebuildIndex();
    updateAll();
  });
  s.addPlayheadListener(() => {
    // Diamonds only care about the playhead when automation exists, and
    // ~10 Hz is plenty for a filled/unfilled flip.
    if (laneIndex.size === 0) return;
    const now = performance.now();
    if (now - lastHeadUpdate < PLAYHEAD_THROTTLE_MS) return;
    lastHeadUpdate = now;
    updateAll();
  });
  rebuildIndex();
  updateAll();
}

/** Called by TimelineDock when it mounts (never on compact layouts). */
export function setDockActions(a: DockActions | null): void {
  dockActions = a;
}

/**
 * Traditional keyframe-editor / auto-key semantics (Blender/Resolve,
 * Ableton/Pro Tools "write" automation): once a param has AT LEAST ONE
 * lane, every panel-knob edit is keyed — never a global base edit,
 * which would shift the whole curve out from under every other
 * keyframe (the reported bug: editing the knob at an un-keyed bar was
 * silently rewriting `Settings` instead of the timeline).
 *
 *   - Playhead sits exactly on a point → rewrite that point's value.
 *   - Playhead sits elsewhere on an automated param → AUTO-CREATE a
 *     new point at the playhead with this value; every other point on
 *     the lane is untouched, so the edit is local to this bar only.
 *   - Param has no lane at all → returns false; the caller falls back
 *     to `settings.set` (a plain, unautomated knob).
 *
 * Matches the diamond's multi-lane convention: prefers whichever lane
 * (in registration order) already has a point at the head; auto-key
 * creates on the FIRST lane if none do. Full multi-lane control lives
 * in the lane editor.
 */
export function setKeyedValueAtPlayhead(
  settings: SettingsStore,
  key: string,
  absTarget: number,
  opts?: { snapshot?: boolean },
): boolean {
  if (!seq?.timeline) return false;
  const keyLanes = laneIndex.get(key) ?? [];
  if (keyLanes.length === 0) return false; // not automated — plain base edit

  const head = seq.playheadBar;
  let lane = keyLanes[0];
  let hit = null as ReturnType<typeof findPointAt>;
  for (const l of keyLanes) {
    const h = findPointAt(l.points, head);
    if (h) { lane = l; hit = h; break; }
  }

  // Other lanes on the same key still contribute at this bar (rare
  // multi-lane case) — hold their contribution steady so only the
  // edited lane's point moves (or a new one is created).
  let otherOffset = 0;
  for (const other of keyLanes) {
    if (other !== lane) otherOffset += evalLane(other.points, head);
  }
  const base = settings.get(key as never) as unknown;
  if (typeof base !== 'number') return false;
  const newValue = absTarget - base - otherOffset;
  seq.editLanes(() => {
    lane.points = upsertPoint(lane.points, { bar: head, value: newValue, easing: hit?.easing });
  }, opts);
  return true;
}

/** True if the param has at least one lane in the current timeline. */
export function hasLane(key: string): boolean {
  return (laneIndex.get(key)?.length ?? 0) > 0;
}

/**
 * Something other than the knob can say what a param's value is right now — the Virtual Camera
 * while a drag previews over its keyframes. When the source returns a number, the ◆ keys that
 * value at the playhead (adding or overwriting a point) instead of toggling.
 */
const keySources = new Map<string, () => number | null>();
export function registerKeySource(key: string, value: () => number | null): void {
  keySources.set(key, value);
}

/**
 * Key absolute values for several params at the playhead in ONE edit (one undo step). A param
 * with no lane gets one; otherwise the point at the playhead is rewritten or a new one added,
 * like an auto-keyed knob edit. Values are absolute (what the param should read), not offsets.
 */
export function keyValuesAtPlayhead(settings: SettingsStore, entries: { key: string; value: number }[]): boolean {
  if (!seq?.timeline) return false;
  const head = seq.playheadBar;
  seq.editLanes((t) => {
    for (const { key, value } of entries) {
      const base = settings.get(key as never) as unknown;
      if (typeof base !== 'number') continue;
      const keyLanes = t.lanes.filter((l) => l.paramKey === key);
      if (keyLanes.length === 0) {
        t.lanes.push({ id: newLaneId(), paramKey: key, enabled: true, points: [{ bar: head, value: value - base }] });
        continue;
      }
      let lane = keyLanes[0];
      let hit = null as ReturnType<typeof findPointAt>;
      for (const l of keyLanes) {
        const h = findPointAt(l.points, head);
        if (h) { lane = l; hit = h; break; }
      }
      let other = 0;
      for (const l of keyLanes) if (l !== lane) other += evalLane(l.points, head);
      lane.points = upsertPoint(lane.points, { bar: head, value: value - base - other, easing: hit?.easing });
    }
  });
  return true;
}

function executeToggle(key: string, settings: SettingsStore, useSource = true): void {
  if (!seq?.timeline) return;
  const sourced = useSource ? keySources.get(key)?.() : null;
  if (typeof sourced === 'number') { keyValuesAtPlayhead(settings, [{ key, value: sourced }]); return; }
  const plan = planToggle(laneIndex.get(key) ?? [], seq.playheadBar);
  seq.editLanes((t) => {
    if (plan.kind === 'createLane') {
      t.lanes.push({ id: newLaneId(), paramKey: key, enabled: true, points: [plan.point] });
      return;
    }
    const lane = t.lanes.find((l) => l.id === plan.laneId);
    if (!lane) return;
    lane.points = plan.kind === 'addPoint'
      ? upsertPoint(lane.points, plan.point)
      : removePointAt(lane.points, plan.bar);
  });
}

function openMenu(btn: HTMLButtonElement, key: string, settings: SettingsStore, x: number, y: number): void {
  const doc = btn.ownerDocument;
  doc.getElementById('rw-kf-menu')?.remove();
  if (!seq?.timeline) return;

  const keyLanes = laneIndex.get(key) ?? [];
  const state = diamondState(keyLanes, seq.playheadBar);

  const ul = doc.createElement('ul');
  ul.id = 'rw-kf-menu';
  ul.className = 'rw-kf-menu';
  ul.style.left = `${x}px`;
  ul.style.top = `${y}px`;

  const item = (label: string, disabled: boolean, onClick?: () => void): void => {
    const li = doc.createElement('li');
    li.textContent = label;
    if (disabled) li.classList.add('disabled');
    else li.addEventListener('click', () => {
      onClick?.();
      ul.remove();
    });
    ul.appendChild(li);
  };

  item(
    'Open in timeline',
    keyLanes.length === 0 || !dockActions,
    () => {
      // Un-hide the dock first if needed; it lives in the MAIN window.
      if (settings.get('timelineDock') === 'hidden') {
        settings.set('timelineDock', settings.get('timelineLastDock'));
      }
      dockActions?.revealLane(keyLanes[0].id);
    },
  );
  item('Remove point at playhead', state !== 'point', () => executeToggle(key, settings, false));
  item(
    keyLanes.length > 1 ? `Remove automation (${keyLanes.length} lanes)` : 'Remove automation',
    keyLanes.length === 0,
    () => {
      seq?.editLanes((t) => {
        t.lanes = t.lanes.filter((l) => l.paramKey !== key);
      });
    },
  );

  doc.body.appendChild(ul);
  // Clamp inside the (possibly popout) window's viewport.
  const win = doc.defaultView ?? window;
  const r = ul.getBoundingClientRect();
  if (x + r.width > win.innerWidth - 4) {
    ul.style.left = `${Math.max(4, win.innerWidth - r.width - 4)}px`;
  }
  if (y + r.height > win.innerHeight - 4) {
    ul.style.top = `${Math.max(4, win.innerHeight - r.height - 4)}px`;
  }
  const dismiss = (ev: MouseEvent): void => {
    if (!ul.contains(ev.target as Node)) {
      ul.remove();
      doc.removeEventListener('click', dismiss);
    }
  };
  // Defer so the opening click doesn't immediately dismiss.
  setTimeout(() => doc.addEventListener('click', dismiss), 0);
}

/**
 * Attach a keyframe diamond to a slider wrap. No-op for keys that aren't
 * modulation targets. Called from `slider()` in widgets.ts — zero
 * per-section changes.
 */
export function attachKeyframeDiamond(
  control: HTMLElement,
  paramKey: string,
  settings: SettingsStore,
): void {
  if (!TARGET_KEYS.has(paramKey)) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rw-kf-diamond';
  btn.textContent = '◇';
  btn.hidden = true; // until a sequencer + timeline exist
  btn.setAttribute('aria-label', `Keyframe ${paramKey} at the playhead`);

  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    executeToggle(paramKey, settings);
  });
  btn.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    openMenu(btn, paramKey, settings, ev.clientX, ev.clientY);
  });
  // Touch: long-press opens the same menu (same 700 ms convention as the
  // slider's numeric-entry long-press).
  let pressTimer = 0;
  btn.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'touch') return;
    pressTimer = window.setTimeout(() => {
      const r = btn.getBoundingClientRect();
      openMenu(btn, paramKey, settings, r.left, r.bottom + 4);
    }, LONG_PRESS_MS);
  });
  const cancelPress = (): void => window.clearTimeout(pressTimer);
  btn.addEventListener('pointerup', cancelPress);
  btn.addEventListener('pointerleave', cancelPress);
  btn.addEventListener('pointercancel', cancelPress);

  // Resolve-style ◀ ▶ jump arrows flanking the diamond: seek the
  // playhead to this param's previous/next keyframe without leaving
  // the panel. Hidden until the param has at least one lane point.
  const mkNav = (dir: -1 | 1): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `rw-kf-nav ${dir < 0 ? 'rw-kf-prev' : 'rw-kf-next'}`;
    b.textContent = dir < 0 ? '◀' : '▶';
    b.title = dir < 0
      ? 'Jump to this param’s previous keyframe'
      : 'Jump to this param’s next keyframe';
    b.hidden = true;
    b.setAttribute('aria-label', `${dir < 0 ? 'Previous' : 'Next'} ${paramKey} keyframe`);
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      jumpParamKeyframe(paramKey, dir);
    });
    return b;
  };
  const prevBtn = mkNav(-1);
  const nextBtn = mkNav(1);

  control.append(prevBtn, btn, nextBtn);
  diamonds.push({ key: paramKey, btn, prevBtn, nextBtn, everConnected: false });

  // Reflect current state immediately (sequencer may already be live —
  // pattern-section rebuilds attach diamonds long after boot).
  if (seq) updateAll();
}
