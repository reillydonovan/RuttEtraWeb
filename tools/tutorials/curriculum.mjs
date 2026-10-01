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
  {
    level: 'Intermediate',
    title: 'Video and sound',
    lessons: [
      { id: 'dual-raster', title: 'Dual Raster', blurb: 'A second raster with its own geometry, wipe and interleave modes, and its own picture from the Patch Bay.' },
      { id: 'audio-reactive', title: 'Audio-reactive', blurb: 'The Audio section, beat detector, spectrum displacement, and an audio-reactive graph patch.' },
      { id: 'oscilloscope', title: 'The Oscilloscope', blurb: 'Draw any signal as a trace and let the raster turn it into terrain.' },
    ],
  },
  {
    level: 'Intermediate',
    title: 'Looks and output',
    lessons: [
      { id: 'looks-deep', title: 'Render modes and Post FX', blurb: 'Wireframe and dot rasters, custom tint, shaped feedback, analog character, chroma, scanlines.' },
      { id: 'save-share', title: 'Save, record, share', blurb: 'User presets, project files, recording a clip, and live sharing with a link and QR code.' },
    ],
  },
  {
    level: 'Advanced',
    title: 'Deep patching',
    lessons: [
      { id: 'clocks-sequencer', title: 'Clocks, sequencers, envelopes', blurb: 'A tempo clock driving a step sequencer, a divided clock firing an ADSR envelope, probed live.' },
      { id: 'feedback-chaos', title: 'Feedback and chaos', blurb: 'Resonant filtered noise, Param Out, a frame delay, and a patch that feeds on itself.' },
      { id: 'video-modulation', title: 'The camera as a source', blurb: 'Video Luma with a picked region, Video Motion through a Slew, and the motion-glitch patch.' },
    ],
  },
  {
    level: 'Advanced',
    title: 'I/O',
    lessons: [
      { id: 'io-midi-osc', title: 'MIDI and OSC', blurb: 'Connect a controller, learn a mapping, MIDI clock in and out, and OSC over the network.' },
      { id: 'io-cv-mcp', title: 'CV, gamepads and MCP', blurb: 'Control voltage inputs, OSC CV, gamepads, and an AI assistant driving the synth over MCP.' },
      { id: 'io-outputs', title: 'Outputs', blurb: 'Sonification and the Sonify node, CV Out to a modular, MIDI clock out, and the safety stack.' },
    ],
  },
  {
    level: 'Advanced',
    title: 'Performance',
    lessons: [
      { id: 'stereo-3d', title: 'Stereo and 3D', blurb: 'Red-cyan anaglyph, side-by-side stereo recording, and WebXR headsets.' },
      { id: 'performance-rig', title: 'A performance rig', blurb: 'Layouts, HUD, shortcuts, performance profiles, output resolution, fly mode, timecode and popouts.' },
      { id: 'showcase', title: 'Showcase: getting weird', blurb: 'Five strange setups: a feedback tunnel, interleaved worlds, resonant chaos, sound terrain, anaglyph Lissajous.' },
    ],
  },
];

export const LESSONS = TRACKS.flatMap((t, ti) =>
  t.lessons.map((l) => ({ ...l, track: t.title, level: t.level, trackIndex: ti })));
LESSONS.forEach((l, i) => { l.number = i + 1; });
