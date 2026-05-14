/**
 * Pure tempo / clock-division math. Single source of truth shared between
 * `MidiClock`, `ModMatrix`, and the Graph `clock` node so the same
 * 1/4-note → Hz conversion isn't reimplemented in three places.
 *
 * No I/O, no DOM, no `Settings` access — easy to unit-test.
 */

import type { ClockDivision } from '../state/Settings';

/**
 * Beats per full cycle of the given division, where 1 beat = one quarter note.
 *
 * Examples (assuming 4/4):
 *   `1/4` → 1   (one cycle per quarter note)
 *   `1/8` → 0.5 (one cycle every eighth note → twice per beat)
 *   `1/1` → 4   (one cycle every whole note → once per bar)
 *   `1/4.` → 1.5 (dotted quarter)
 *   `1/4T` → 2/3 (quarter triplet)
 */
export function divisionToBeats(div: ClockDivision): number {
  switch (div) {
    case '1/1':   return 4;
    case '1/2':   return 2;
    case '1/4':   return 1;
    case '1/8':   return 0.5;
    case '1/16':  return 0.25;
    case '1/32':  return 0.125;
    case '1/4.':  return 1.5;
    case '1/8.':  return 0.75;
    case '1/16.': return 0.375;
    case '1/4T':  return 2 / 3;
    case '1/8T':  return 1 / 3;
    case '1/16T': return 1 / 6;
  }
}

/**
 * Hz of one full LFO cycle at the given division and BPM.
 *
 *     hz = beatsPerSecond / beatsPerCycle
 *        = (bpm / 60) / divisionToBeats(div)
 */
export function divisionToHz(div: ClockDivision, bpm: number): number {
  return (bpm / 60) / divisionToBeats(div);
}

/** All divisions in user-facing display order. */
export const ALL_DIVISIONS: ClockDivision[] = [
  '1/1', '1/2', '1/4', '1/8', '1/16', '1/32',
  '1/4.', '1/8.', '1/16.',
  '1/4T', '1/8T', '1/16T',
];
