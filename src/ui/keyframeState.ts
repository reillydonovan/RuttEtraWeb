/**
 * Pure decision logic for the inline keyframe diamond (◆) on panel rows.
 *
 * The diamond has exactly three states and one click gesture; everything
 * it can do is expressed here as data so the DOM layer stays a thin
 * executor and the semantics are node-testable.
 *
 * Multi-lane convention: a param can have several lanes (they sum). The
 * diamond reports 'point' if ANY lane has a point at the playhead, and
 * its toggle operates on the FIRST lane for the key — full multi-lane
 * control lives in the lane editor, not the diamond.
 */

import { AutomationLane, AutomationPoint } from '../sequencer/types';
import { evalLane } from '../sequencer/lanes';
import { findPointAt } from './timeline/laneGeometry';

export type DiamondState = 'none' | 'lane' | 'point';

export function lanesForKey(lanes: AutomationLane[], paramKey: string): AutomationLane[] {
  return lanes.filter((l) => l.paramKey === paramKey);
}

export function diamondState(keyLanes: AutomationLane[], headBar: number): DiamondState {
  if (keyLanes.length === 0) return 'none';
  for (const lane of keyLanes) {
    if (findPointAt(lane.points, headBar)) return 'point';
  }
  return 'lane';
}

export type TogglePlan =
  | { kind: 'createLane'; point: AutomationPoint }
  | { kind: 'addPoint'; laneId: string; point: AutomationPoint }
  | { kind: 'removePoint'; laneId: string; bar: number };

/**
 * What one ◆ click should do at `headBar`:
 *   - no lane        → create one with a single 0-offset point (live value
 *                      is unchanged — offset 0 contributes nothing);
 *   - lane, no point → add a point pinning the lane's current evaluated
 *                      offset (live value is unchanged — the curve already
 *                      passes through it);
 *   - point at head  → remove it (toggle), addressed by its exact stored
 *                      bar so float playheads can't miss.
 */
export function planToggle(keyLanes: AutomationLane[], headBar: number): TogglePlan {
  for (const lane of keyLanes) {
    const hit = findPointAt(lane.points, headBar);
    if (hit) return { kind: 'removePoint', laneId: lane.id, bar: hit.bar };
  }
  if (keyLanes.length === 0) {
    return { kind: 'createLane', point: { bar: headBar, value: 0 } };
  }
  const lane = keyLanes[0];
  return {
    kind: 'addPoint',
    laneId: lane.id,
    point: { bar: headBar, value: evalLane(lane.points, headBar) },
  };
}
