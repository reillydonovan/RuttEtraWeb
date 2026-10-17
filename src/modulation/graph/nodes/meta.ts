/**
 * Meta nodes — documentation, not signal processing.
 *
 * `note` has no inputs, no outputs, and a no-op tick; it exists purely so
 * a patch can carry its own explanation on the canvas (ComfyUI-style).
 * Its one param (`text`) is edited inline in the node body on the canvas
 * (`AdvancedView.renderNode`'s 'note' branch), not through the side
 * inspector — see `inspector.ts`'s `NOTE_NODE_TYPES` skip.
 */

import { register } from '../registry';

register<{}>({
  type: 'note',
  category: 'Meta',
  label: 'Note',
  description: 'Free-text annotation — documents a patch, no signal effect.',
  inputs: [],
  outputs: [],
  params: {
    text: { kind: 'text', default: 'Note', help: 'The note’s text — write anything that explains the patch.' },
  },
  init: () => ({}),
  tick: () => {},
});
