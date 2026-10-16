# Production notes — problems found while making the videos, and what was done

A running log (owner: "when making videos, note problems you encounter and fix them as you go").
Newest first. Each entry: what went wrong, how it was found, the fix, and where.

## 2026-10-15/16 — Modern re-record, phone + Patch Bay lessons, Laura voice

**Tours that claimed things the app hadn't done**
- *first-look*: "drag the LFO onto Z Push" — the cable never connected (the Patch Bay had scrolled, so the drag ended on empty space) but the narration said it did. Found by the owner. Fixed the tour (`dragPan` carries the cable to the top edge) **and added the missing guard in the harness**: `h.drag`/`h.dragPan` now fail the take if a cable dropped on a jack doesn't light it up as plugged, and `h.knob` fails if the value doesn't change. A dry run of all 31 lessons with the guard found no other silent misses.
- `dragPan` waited ~7 s for the board to scroll; on the recording machine edge auto-pan is slower. Now waits up to ~25 s (patchbay-cables had failed once).
- *oscilloscope*: a leftover second knob turn on a knob already at its maximum — removed.

**App bugs found by making the videos (all fixed)**
- Resolution dropdown was blank on a fresh profile (default 640×480 wasn't one of its options). Added VGA and a "custom" fallback so it never shows blank.
- Changing Resolution/FPS did nothing to a running camera and said nothing about it. It now restarts the camera and reports the size it actually got (a 1080p camera asked for 4K says so).
- Patch Bay: a `<select>` or checkbox that had been used kept focus and so was skipped by value refreshes — dropping TRI on an LFO's shape jack left the dropdown on "sine". Refreshes now skip only text-entry controls.
- Patch Bay: grabbing the input end of a cable fed by a Param Out node made its other end jump to the Param Out module. The rubber-band now stays anchored where the resting cable was. Releasing over empty space now leaves a fading "unplug ghost" so the disconnection is visible.
- Controls ▸ sub-groups (Capture Settings, Webcam, Pattern Generator, …) had no ⓘ. Every group now has one (`src/ui/help/groupHints.ts`).
- The mirrored default layout (Controls left, Patch Bay right) is a CSS/inset mirror of the old one, because only the primary Controls panel has search, rack cables and a working popout.
- Modulation (Classic + Graph Beginner): the slot header was an overflowing grid (buttons overlapping, no AMT value, ▶ that read as "play"). Rebuilt as three lines (source · amount+target · Copy/Paste vs Reset/Remove), numeric fields restored, chevron expand, Modern segmented controls for Classic|Graph|Both and Beginner|Advanced.
- The BPM field (Tempo) rendered empty under the Hardware/Rack skins: skin.css hid every native range/number inside any `.rw-slider`, even hand-built ones with no knob. The hide rule now applies only where a knob stands in.

**Pipeline**
- Lesson numbers are global and are baked into each video's intro card, so inserting lessons means re-recording everything after them. (Done.)
- ElevenLabs engine added (`--voice elevenlabs:<voiceId>`), key in `tools/tutorials/.env` (gitignored). `--dest <dir>` auditions a voice without touching the published course.
- A portrait phone lesson needs its own recording size; the tutorials page frames it from a manifest `aspect`.
