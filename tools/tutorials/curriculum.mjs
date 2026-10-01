// The video course: ordered tracks of short lessons that build on each other,
// grouped into levels (Beginner / Intermediate / Advanced).
// One source for build order, lesson numbering, and the About page listing
// (build.mjs rewrites the video-course block in docs/about/10-tutorials.md
// from this list).

export const TRACKS = [
  {
    level: 'Beginner',
    title: 'Getting started',
    lessons: [
      { id: 'first-look', title: 'First look', blurb: 'Pick a source, orbit the camera, turn up Z Push, and make your first patch.' },
      { id: 'workspace', title: 'Windows, tabs and layouts', blurb: 'Switch tabs, maximize a window, try layout presets, and change the panel skin.' },
      { id: 'sources', title: 'Sources', blurb: 'Pattern Generator kinds, and loading a video file as the picture.' },
    ],
  },
  {
    level: 'Beginner',
    title: 'The Controls panel',
    lessons: [
      { id: 'controls-tour', title: 'Finding your way around', blurb: 'Tabs, sections, search, knobs, ranges, and the ⓘ help.' },
      { id: 'shaping', title: 'Shaping the raster', blurb: 'Size, depth, rotation and luminance — the scan processor itself.' },
      { id: 'look', title: 'Color, glow and presets', blurb: 'Bloom, feedback, the virtual camera, and one-click presets.' },
      { id: 'modulation', title: 'Modulation', blurb: 'A Classic modulation slot: a sine wave moving a parameter.' },
    ],
  },
  {
    level: 'Beginner',
    title: 'The Timeline',
    lessons: [
      { id: 'timeline-keyframes', title: 'Keyframes', blurb: 'Create a timeline, key a parameter at two bars, and play it back.' },
      { id: 'timeline-scenes', title: 'Scenes', blurb: 'Snapshot whole looks as scenes and let the timeline move between them.' },
    ],
  },
  {
    level: 'Beginner',
    title: 'The Patch Bay',
    lessons: [
      { id: 'patchbay-cables', title: 'Cables', blurb: 'Waveforms into a function generator, its output into a parameter; move and unplug.' },
      { id: 'patchbay-nodes', title: 'Nodes and the Scope', blurb: 'Add nodes with a right-click, watch signals on a Scope, delete what you do not need.' },
      { id: 'patchbay-video', title: 'Video routing', blurb: 'Composite a video file with the Pattern Generator and feed the renderer.' },
    ],
  },
  {
    level: 'Intermediate',
    title: 'The Graph engine',
    lessons: [
      { id: 'graph-beginner', title: 'Graph mode and the Library', blurb: 'Beginner view rows, Noise and Ramp sources, ready-made patches, and Both mode.' },
      { id: 'graph-advanced', title: 'The Advanced canvas', blurb: 'Add nodes, wire them, edit them in the inspector, bind to the synth, and probe a signal.' },
    ],
  },
];

export const LESSONS = TRACKS.flatMap((t, ti) =>
  t.lessons.map((l) => ({ ...l, track: t.title, level: t.level, trackIndex: ti })));
LESSONS.forEach((l, i) => { l.number = i + 1; });
