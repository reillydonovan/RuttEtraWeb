/**
 * Step content for the Patch Bay walkthrough (Help ▸ Patch Bay
 * Tutorial) — the second guided tour, teaching the modular-patching
 * surface specifically: spawn a node, turn its knobs, wire it to a
 * param, read the live values, splice a scope in. Same engine
 * (`Tutorial.ts`), same rules (opt-in only, Esc exits, spotlight stays
 * interactive), separate copy file for the same reason as
 * `tutorialSteps.ts`.
 *
 * Targets live inside the Patch Bay view, which the DEFAULT layout
 * docks in the LEFT window — step 1's `before()` re-docks it there if
 * the user moved it somewhere the main document can't see (a popout);
 * everything else resolves inside `.rw-patchbay` at target() time, so
 * steps track whichever bay instance is visible.
 */

import { TutorialStep } from './Tutorial';

function inBay(sel: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.rw-patchbay ${sel}`);
}

/** The bay module whose title matches, e.g. a spawned LFO's module. */
function bayModule(title: string): HTMLElement | null {
  for (const m of document.querySelectorAll<HTMLElement>('.rw-patchbay .rw-pb-graphnode')) {
    if (m.querySelector('.rw-pb-graphnode-title')?.textContent?.trim() === title) return m;
  }
  return null;
}

/** A faceplate cell by its engraved label. */
function bayCell(label: string): HTMLElement | null {
  for (const c of document.querySelectorAll<HTMLElement>('.rw-patchbay .rw-pb-cell')) {
    if (c.querySelector('.rw-pb-cell-top span:not(.rw-rack-jack)')?.textContent?.trim() === label) return c;
  }
  return null;
}

export interface PatchTutorialDeps {
  /** Bring a Patch Bay instance on-screen (Window ▸ Layout ▸ Default). */
  showPatchBay(): void;
  /** Programmatic "right-click add" for the try-it step. */
  addNode(type: 'lfo' | 'scope'): void;
}

export function buildPatchBayTutorialSteps(deps: PatchTutorialDeps): TutorialStep[] {
  return [
    {
      title: 'The Patch Bay',
      body:
        'This is the whole synth as a modular faceplate — every parameter ' +
        'is a jack with a knob, and cables ARE the patch. This tour wires ' +
        'one LFO the hardware way. Esc exits anytime.',
      before: () => deps.showPatchBay(),
      target: () => inBay('.rw-pb-bus') ?? document.querySelector<HTMLElement>('.rw-patchbay'),
    },
    {
      title: 'Every param is a station',
      body:
        'IN jack on the left (modulation arrives here), OUT jack on the ' +
        'right (this param as a signal), a knob, and its value. Try the ' +
        'knob — drag vertically, Shift for fine.',
      target: () => bayCell('Z Push'),
    },
    {
      title: 'Spawn a node',
      body:
        'Right-click any empty board space for the Add Node menu — every ' +
        'generator, processor, and I/O node lives there. This button drops ' +
        'an LFO in for you.',
      action: {
        label: 'Add an LFO',
        run: () => deps.addNode('lfo'),
      },
      target: () => bayModule('LFO') ?? inBay('.rw-pb-rail'),
    },
    {
      title: 'The LFO is a module',
      body:
        'Knobs for rate and phase, a dropdown for shape (drag a SOURCES ' +
        'waveform jack onto the small shape jack — TRI makes a triangle ' +
        'wave), a mute LED, and an OUT jack. Drag the header to move the ' +
        'whole module anywhere.',
      target: () => bayModule('LFO'),
    },
    {
      title: 'Patch it',
      body:
        'Drag the LFO\'s OUT jack onto any param\'s IN jack — try Z Push. ' +
        'The moment it lands you\'ll see the amber needle and ▸ readout: ' +
        'that\'s the LIVE value riding on top of the knob\'s base value.',
      target: () => bayModule('LFO')?.querySelector<HTMLElement>('.rw-pb-row--out .rw-rack-jack') ?? bayModule('LFO'),
    },
    {
      title: 'See the signal',
      body:
        'A Scope passes its input straight through and draws it. Splice ' +
        'one between any two points — this button adds one; wire the ' +
        'LFO\'s OUT into its IN to watch the wave.',
      action: {
        label: 'Add a Scope',
        run: () => deps.addNode('scope'),
      },
      target: () => bayModule('Scope') ?? inBay('.rw-pb-rail'),
    },
    {
      title: 'Arrange your rig',
      body:
        'Drag module headers to reorder the stacks, or drop one out past ' +
        'them for free Max/MSP-style placement (they never overlap). TIDY ' +
        'in the SOURCES bar snaps everything back. Scroll-wheel zooms; ' +
        'drag empty space to pan.',
      target: () => inBay('.rw-pb-tidy') ?? inBay('.rw-pb-bus'),
    },
    {
      title: 'That\'s the bay',
      body:
        'Everything stays in sync with the Controls tab — same knobs, ' +
        'same patch, two faces. Your patch saves with Projects, Presets, ' +
        'and Timelines automatically. Right-click → add nodes, and go make ' +
        'something weird.',
    },
  ];
}
