/** Display names for graph node params — one rule for every surface (Controls rows, Patch Bay
 *  modules, the Advanced inspector). A param's `label` wins; otherwise the key is spelled out
 *  ("timeSec" → "Time Sec"). */

import type { ParamSpec } from './types';

export function paramLabel(name: string, spec?: ParamSpec): string {
  if (spec?.label) return spec.label;
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Display text for one enum option. */
export function optionLabel(spec: ParamSpec | undefined, value: string): string {
  return (spec && spec.kind === 'enum' && spec.optionLabels?.[value]) || value;
}
