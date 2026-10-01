// Advanced — 3D output: anaglyph, side-by-side stereo recording, WebXR.
import { bootPattern } from '../lib/helpers.mjs';

export const lines = [
  { id: 'intro', text: 'The raster is a real 3D object, so it can be shown in real 3D. Three ways: anaglyph, side-by-side stereo, and WebXR headsets.' },
  { id: 'anaglyph', text: 'Anaglyph is in the Virtual Camera section. Switch it on and grab some red and cyan glasses.' },
  { id: 'ipd', text: 'Eye Sep sets how far apart the two eyes are. More separation, more depth. Orbit the camera to feel it.' },
  { id: 'stereo', text: 'For VR players and YouTube, the Record section can capture side-by-side stereo, with an optional 3D metadata tag.' },
  { id: 'preview', text: 'Preview stereo shows both eyes for three seconds, before you commit to a recording.' },
  { id: 'xr', text: 'With a WebXR headset connected, the XR section puts you inside the raster, at tabletop, room or architectural scale.' },
  { id: 'outro', text: 'Next: building a performance rig.' },
];
export const poster = 'ipd';

export async function pre(page) { await bootPattern(page); }

export async function run(page, seg, h) {
  await seg('intro', async () => { await h.wait(2600); await h.glide({ x: 980, y: 450 }, 40); });

  await seg('anaglyph', async () => {
    await h.section('Virtual Camera');
    await h.click('#panel-root .rw-toggle[data-param-key="anaglyphEnabled"]');
    await h.glide({ x: 980, y: 450 }, 40);
  });

  await seg('ipd', async () => {
    await h.knob(await h.at('#panel-root [data-param-key="anaglyphIpdCm"] .rw-knob'), 40, 40);
    await h.drag({ x: 860, y: 450 }, { x: 1100, y: 380 }, 90);
  });

  await seg('stereo', async () => {
    await h.click('#panel-root .rw-toggle[data-param-key="anaglyphEnabled"]');
    await h.section('Record');
    await h.click('#panel-root .rw-toggle[data-param-key="stereoRecordingEnabled"]');
    await h.wait(400);
    await h.glide(await h.at('#panel-root .rw-toggle[data-param-key="stereoInjectMetadata"]'), 25);
  });

  await seg('preview', async () => {
    await h.click(`${await h.sec('Record')} .rw-btn`, 'Preview stereo (3 s)', { exact: true });
    await h.glide({ x: 980, y: 450 }, 30);
    await h.wait(3200);
  });

  await seg('xr', async () => {
    await h.click('#panel-root .rw-toggle[data-param-key="stereoRecordingEnabled"]');
    await h.section('XR');
    await h.glide(await h.at(`${await h.sec('XR')} .rw-section-body`), 30);
  });

  await seg('outro', async () => { await h.glide({ x: 980, y: 450 }, 40); });
}
