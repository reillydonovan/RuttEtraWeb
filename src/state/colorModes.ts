/**
 * The phosphor tint each Color Mode draws with — ONE table, read by the
 * renderer (RuttEtra.applyTint) and by the timeline's scene interpolation
 * (interp.ts), so a green → amber scene change glides through the same
 * colours the renderer shows at either end.
 *
 * Pure, no three.js.
 */
import type { ColorMode } from './Settings';

export const PHOSPHOR_GREEN_HEX = '#5fff85';
export const PHOSPHOR_AMBER_HEX = '#ffb347';

/** The tint a mode multiplies brightness by, or null for 'video' (sampled colour, no tint). */
export function tintHexFor(mode: ColorMode, customHex: string): string | null {
  switch (mode) {
    case 'phosphorGreen':  return PHOSPHOR_GREEN_HEX;
    case 'phosphorAmber':  return PHOSPHOR_AMBER_HEX;
    case 'phosphorCustom': return customHex;
    case 'grayscale':      return '#ffffff';
    default:               return null;
  }
}
