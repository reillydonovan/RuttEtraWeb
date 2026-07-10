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
import { upsertPoint, removePointAt } from '../sequencer/lanes';
import { SettingsStore } from '../state/Settings';
import { TARGETS } from './targets';
import { diamondState, planToggle } from './keyframeState';

const TARGET_KEYS = new Set<string>(TARGETS.map((t) => t.v as string));
const PLAYHEAD_THROTTLE_MS = 100;
const LONG_PRESS_MS = 700;

interface DockActions {
  revealLane(laneId: string): void;
}

interface DiamondEntry {
  key: string;
  btn: HTMLButtonElement;
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
  for (const { key, btn } of diamonds) {
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
    // Row marker so the panel shows which params carry automation.
    btn.closest('.rw-row')?.classList.toggle('rw-row--animated', keyLanes.length > 0);
  }
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

function executeToggle(key: string): void {
  if (!seq?.timeline) return;
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
  item('Remove point at playhead', state !== 'point', () => executeToggle(key));
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
    executeToggle(paramKey);
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

  control.appendChild(btn);
  diamonds.push({ key: paramKey, btn, everConnected: false });

  // Reflect current state immediately (sequencer may already be live —
  // pattern-section rebuilds attach diamonds long after boot).
  if (seq) updateAll();
}
