/**
 * Step content for the "make your first patch" walkthrough. Kept
 * separate from `Tutorial.ts` (the engine) so the actual copy is easy to
 * scan/edit without wading through spotlight/positioning code.
 */

import { SettingsStore } from '../../state/Settings';
import { ControlPanel } from '../ControlPanel';
import { STARTER_PATCHES, StarterPatch } from '../../modulation/graph/library';
import { TutorialStep } from './Tutorial';

export interface TutorialDeps {
  settings: SettingsStore;
  panel: ControlPanel;
  loadSamplePatch: (sp: StarterPatch) => Promise<void>;
}

/**
 * Expand (and reattach, if a workspace region moved it) a section so its
 * contents exist and are measurable. Deliberately does NOT scroll —
 * `Tutorial.ts` scrolls to whatever the step's `target()` actually
 * resolves to (a specific param row, if the step has one), which can
 * differ from the section as a whole; scrolling here to the section
 * first would just be immediately overridden, and for a long section
 * scrolling to its *center* can push a param row near its top or bottom
 * off-screen anyway.
 */
function reveal(panel: ControlPanel, title: string): void {
  panel.reattachSection(title);
  panel.getSection(title)?.classList.remove('collapsed');
}

function byParamKey(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-param-key="${key}"]`);
}

/** Find a button by its exact visible label — several controls (Use
 *  Webcam, etc.) share the plain `.rw-btn` class with no unique hook. */
function byButtonText(text: string): HTMLElement | null {
  const btns = document.querySelectorAll<HTMLElement>('button');
  for (const b of btns) if (b.textContent?.trim() === text) return b;
  return null;
}

export function buildTutorialSteps(deps: TutorialDeps): TutorialStep[] {
  const { settings, panel, loadSamplePatch } = deps;
  const gettingStarted = STARTER_PATCHES.find((p) => p.id === 'getting-started') ?? STARTER_PATCHES[0];

  return [
    {
      title: 'Welcome to Rutt/Etra Web',
      body:
        'This walkthrough builds one simple patch: a video source pushed ' +
        'into 3D by brightness, with a gentle animated wobble. About 2 ' +
        'minutes. Press Esc anytime to exit — nothing here is required.',
    },
    {
      title: 'Pick a source',
      body:
        'Webcam, Screen, or a File — the mesh reacts to whatever it sees. ' +
        'No source yet? The Pattern Generator further down makes its own ' +
        'test image.',
      before: () => { settings.set('panelTab', 'synth'); reveal(panel, 'Video Source A'); },
      target: () => byButtonText('Use Webcam') ?? panel.getSection('Video Source A'),
    },
    {
      title: 'Z Push — the core effect',
      body:
        'This is the Rutt/Etra effect itself: brightness pushes the ' +
        'scan-line mesh toward the camera. Drag it and watch the shape ' +
        'change in real time.',
      before: () => { reveal(panel, 'Display Control Unit'); },
      target: () => byParamKey('zPush') ?? panel.getSection('Display Control Unit'),
    },
    {
      title: 'Move the camera',
      body:
        'Click the canvas, then WASD + mouse-look for a free-flight ' +
        'camera, or drag to orbit without clicking first. Scroll to dolly.',
      before: () => { reveal(panel, 'Virtual Camera'); },
      // The instructions are about the 3D view itself, not a panel
      // param — spotlight the render canvas, not the Camera section's
      // (long) list of FOV/near/far/speed sliders.
      target: () => document.getElementById('stage'),
    },
    {
      title: 'Make it move on its own',
      body:
        'The Classic tab gives you 4 simple LFO slots — pick a Target ' +
        'and a shape, done. For bigger patches (or math between signals), ' +
        'switch to Graph mode: a node editor with its own Sample Patches ' +
        'and free-text Note nodes for documenting what you built.',
      before: () => { reveal(panel, 'Modulation'); },
      target: () => document.querySelector<HTMLElement>('.rw-mod-mode-switch') ?? panel.getSection('Modulation'),
    },
    {
      title: 'Try a sample patch',
      body:
        `"${gettingStarted.name}" is a tiny graph patch with a Note node ` +
        'explaining itself, already wired to Z Push. File ▸ Load Sample ' +
        'Patch has more — or load this one right now:',
      action: { label: `Load "${gettingStarted.name}"`, run: () => void loadSamplePatch(gettingStarted) },
    },
    {
      title: 'Save your look',
      body:
        'Happy with a result? Save it as a preset here, or use File ▸ ' +
        'Save As to save the whole project — settings, presets, and ' +
        'timelines together.',
      before: () => { reveal(panel, 'Presets'); },
      target: () => document.querySelector<HTMLElement>('.rw-preset-chips') ?? panel.getSection('Presets'),
    },
    {
      title: "That's the loop",
      body:
        'Source → push → camera → modulate → save. From here: the Patch ' +
        'Bay (a cabled hardware-style view of the same patches), the ' +
        'Graph editor, MIDI/OSC/CV I/O, and the full manual (Help ▸ Open ' +
        'Manual) are all worth exploring. Re-run this anytime from ' +
        'Help ▸ Start Tutorial.',
    },
  ];
}
