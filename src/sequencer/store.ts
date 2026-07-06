/**
 * Persistence + JSON I/O for timelines.
 *
 * Auto-save is OFF by default (see `autoPersist` flag) — timelines live
 * in memory only and are wiped on refresh, matching the rest of the GUI.
 * Explicit save/load is still available via `exportTimeline()` /
 * `importTimelineJson()` and the future "Save / Load" UI buttons.
 *
 * Export supports two modes:
 *   - 'snapshots': fully self-contained (default).
 *   - 'compact':   any keyframe whose snapshot exactly matches a built-in
 *                  preset is written as `{ presetRef: '<id>' }` and re-expanded
 *                  on import.
 */

import { Timeline, makeEmptyTimeline, newTimelineId, newKeyframeId, DEFAULT_EXCLUDED_PARAMS } from './types';
import { PRESETS } from '../ui/presets';
import { pushMigrationNotice } from '../state/Settings';

const STORAGE_KEY = 'ruttetra.timelines.v1';

/**
 * When `false` (the default), timelines never read from or write to
 * localStorage; the in-memory list is the source of truth. Flip to `true`
 * to restore the legacy behaviour.
 */
export let autoPersist = false;

/** Toggle programmatic auto-persistence (mainly for the future Save/Load UI). */
export function setAutoPersist(on: boolean): void { autoPersist = on; }

export function loadTimelines(): Timeline[] {
  if (!autoPersist) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeTimeline);
  } catch (err) {
    console.warn('[timelines] Failed to load', err);
    return [];
  }
}

export function saveTimelines(list: Timeline[]): void {
  if (!autoPersist) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('[timelines] Failed to save', err);
  }
}

export function upsertTimeline(t: Timeline): Timeline[] {
  const list = loadTimelines();
  const i = list.findIndex(x => x.id === t.id);
  if (i >= 0) list[i] = t; else list.push(t);
  saveTimelines(list);
  return list;
}

export function deleteTimeline(id: string): Timeline[] {
  const list = loadTimelines().filter(x => x.id !== id);
  saveTimelines(list);
  return list;
}

// ---------------------------------------------------------------------------
// JSON export / import
// ---------------------------------------------------------------------------

export interface ExportedTimeline {
  _v: 1;
  type: 'ruttetra-timeline';
  exportedAt: string;
  mode: 'snapshots' | 'compact';
  timeline: Timeline | CompactTimeline;
}

interface CompactKeyframe {
  id: string;
  bar: number;
  presetName?: string;
  easing: Timeline['keyframes'][number]['easing'];
  locked?: boolean;
  color?: string;
  presetRef?: string;
  presetSnapshot?: Timeline['keyframes'][number]['presetSnapshot'];
}

interface CompactTimeline extends Omit<Timeline, 'keyframes'> {
  keyframes: CompactKeyframe[];
}

export function exportTimeline(t: Timeline, mode: 'snapshots' | 'compact' = 'snapshots'): string {
  const out: ExportedTimeline = {
    _v: 1,
    type: 'ruttetra-timeline',
    exportedAt: new Date().toISOString(),
    mode,
    timeline: mode === 'compact' ? toCompact(t) : t,
  };
  return JSON.stringify(out, null, 2);
}

export function importTimelineJson(json: string): Timeline {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid timeline JSON');
  }
  // Accept either the wrapped envelope or a bare timeline.
  let raw: unknown;
  let mode: 'snapshots' | 'compact' = 'snapshots';
  if (parsed.type === 'ruttetra-timeline' && parsed.timeline) {
    raw = parsed.timeline;
    mode = parsed.mode === 'compact' ? 'compact' : 'snapshots';
  } else {
    raw = parsed;
  }
  let t: Timeline;
  if (mode === 'compact') {
    t = fromCompact(raw as CompactTimeline);
  } else {
    t = normalizeTimeline(raw as Partial<Timeline>);
  }
  // Always assign a fresh id on import to avoid clashing with an existing one.
  t.id = newTimelineId();
  return t;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeTimeline(raw: Partial<Timeline> & Record<string, unknown>): Timeline {
  // v8: per-timeline `bpm` is removed. If a legacy timeline carries a
  // non-default BPM, surface it as a migration notice (toast) so the user
  // can manually restore it via the global Tempo control. We do NOT
  // silently import the value — the master spec calls out silent
  // value-picking as a smell.
  const legacyBpm = raw.bpm;
  if (typeof legacyBpm === 'number' && Number.isFinite(legacyBpm) && legacyBpm !== 120) {
    const tlName = typeof raw.name === 'string' ? raw.name : 'Untitled';
    pushMigrationNotice(`Timeline "${tlName}" had BPM ${Math.round(legacyBpm)}; set the global Tempo manually.`);
  }
  // Strip any stray fields that no longer exist on `Timeline` so the spread
  // below doesn't carry them through.
  const { bpm: _drop, ...rest } = raw as { bpm?: unknown } & Record<string, unknown>;
  void _drop;

  // Timeline v1 -> v2 (Keyframing v2, AUDIT item 25): backfill
  // `lanes: []` and sanitize any present lanes — malformed entries are
  // dropped individually rather than failing the whole load.
  const lanes: Timeline['lanes'] = Array.isArray(rest.lanes)
    ? (rest.lanes as unknown[])
        .filter((l): l is Timeline['lanes'][number] =>
          !!l && typeof l === 'object' &&
          typeof (l as { paramKey?: unknown }).paramKey === 'string' &&
          Array.isArray((l as { points?: unknown }).points))
        .map((l) => ({
          id: typeof l.id === 'string' ? l.id : `ln_norm_${Math.abs(JSON.stringify(l).length)}`,
          paramKey: l.paramKey,
          enabled: l.enabled !== false,
          points: l.points
            .filter((p) => typeof p?.bar === 'number' && typeof p?.value === 'number')
            .sort((a, b) => a.bar - b.bar),
        }))
    : [];

  const base = makeEmptyTimeline(typeof raw.name === 'string' ? raw.name : 'Imported');
  const t: Timeline = {
    ...base,
    ...rest,
    _v: 2,
    lanes,
    beatsPerBar: clampNum(rest.beatsPerBar, 1, 16, 4),
    lengthBars:  clampNum(rest.lengthBars,  1, 9999, 16),
    loop: rest.loop !== false,
    syncMode: rest.syncMode === 'midi' ? 'midi' : 'internal',
    excludedParams: Array.isArray(rest.excludedParams)
      ? (rest.excludedParams as string[])
      : [...DEFAULT_EXCLUDED_PARAMS],
    keyframes: Array.isArray(rest.keyframes)
      ? ((rest.keyframes as unknown[]).map((k) => normalizeKeyframe(k as Partial<Timeline['keyframes'][number]> & Record<string, unknown>)))
      : [],
  };
  t.keyframes.sort((a, b) => a.bar - b.bar);
  return t;
}

function normalizeKeyframe(raw: Partial<Timeline['keyframes'][number]> & Record<string, unknown>): Timeline['keyframes'][number] {
  return {
    id: typeof raw.id === 'string' ? raw.id : newKeyframeId(),
    bar: clampNum(raw.bar as number, 0, 9999, 0),
    presetSnapshot: (raw.presetSnapshot as Timeline['keyframes'][number]['presetSnapshot']) ?? {},
    presetName: typeof raw.presetName === 'string' ? raw.presetName : undefined,
    easing: (raw.easing as Timeline['keyframes'][number]['easing']) ?? 'easeInOut',
    locked: raw.locked === true ? true : undefined,
    color: typeof raw.color === 'string' ? raw.color : undefined,
  };
}

function clampNum(v: unknown, lo: number, hi: number, def: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
  return Math.max(lo, Math.min(hi, n));
}

function toCompact(t: Timeline): CompactTimeline {
  const compactKfs: CompactKeyframe[] = t.keyframes.map(kf => {
    const ref = matchBuiltinPreset(kf.presetSnapshot);
    if (ref) {
      return {
        id: kf.id, bar: kf.bar, easing: kf.easing,
        presetName: kf.presetName ?? ref, locked: kf.locked, color: kf.color,
        presetRef: ref,
      };
    }
    return {
      id: kf.id, bar: kf.bar, easing: kf.easing,
      presetName: kf.presetName, locked: kf.locked, color: kf.color,
      presetSnapshot: kf.presetSnapshot,
    };
  });
  return { ...t, keyframes: compactKfs };
}

function fromCompact(c: CompactTimeline): Timeline {
  const expanded: Timeline['keyframes'] = c.keyframes.map(kf => ({
    id: kf.id ?? newKeyframeId(),
    bar: kf.bar,
    easing: kf.easing,
    presetName: kf.presetName,
    locked: kf.locked,
    color: kf.color,
    presetSnapshot: kf.presetRef
      ? (PRESETS.find(p => p.id === kf.presetRef)?.values ?? {})
      : (kf.presetSnapshot ?? {}),
  }));
  return normalizeTimeline({ ...c, keyframes: expanded });
}

function matchBuiltinPreset(snapshot: Record<string, unknown>): string | null {
  // Exact match against the values blob of a built-in preset (key-by-key).
  for (const p of PRESETS) {
    const pv = p.values as Record<string, unknown>;
    const pKeys = Object.keys(pv);
    const sKeys = Object.keys(snapshot);
    if (pKeys.length !== sKeys.length) continue;
    let same = true;
    for (const k of pKeys) {
      if (!(k in snapshot) || !Object.is(pv[k], snapshot[k])) { same = false; break; }
    }
    if (same) return p.id;
  }
  return null;
}
