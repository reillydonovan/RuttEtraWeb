/**
 * Side-effect-only module that registers every built-in node type.
 *
 * Kept separate from `registry.ts` so the registry stays a pure leaf
 * module and node files can `import { register } from '../registry'`
 * without forming an ES-module cycle (which lands `register` in TDZ
 * during the cyclic import).
 *
 * Anything that needs a populated registry — `GraphEngine`, the test
 * helpers, the palette — should `import './bootstrap';` once at the
 * top of the file.
 */

import './nodes/sources';
import './nodes/audio';
import './nodes/video';
import './nodes/inputs';
import './nodes/outputs';
import './nodes/processors';
import './nodes/logic';
import './nodes/meta';
