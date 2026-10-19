// Advanced — the camera image as a modulation source (Video nodes).
import { graphHelpers } from '../lib/graph.mjs';

export const fakeMedia = true;

export const lines = [
  { id: 'intro', text: 'The picture can drive the synth, too. Video nodes measure brightness, motion, color and edges in the live image.' },
  { id: 'luma', text: 'Add Video Luma. It reports how bright a region of the frame is.' },
  { id: 'region', text: 'Drag on the thumbnail in the inspector to choose the region. Here, the moving shape in the middle.' },
  { id: 'bind', text: 'Bind it to Z Push. Now the depth follows that part of the picture.' },
  { id: 'motion', text: 'Video Motion measures how much the image is changing. Smooth it with a Slew, and send it to Bloom.' },
  { id: 'library', text: 'The Library has more: Motion-Triggered Glitch tears the raster whenever something moves.' },
  { id: 'watch', text: 'Restore the window. The camera is now playing the synth.' },
  { id: 'outro', text: 'Point a webcam at a dancer, a lava lamp, or your own hands. Next: MIDI and OSC.' },
];
export const poster = 'watch';

export async function pre(page, h) {
  await page.click('#boot-webcam');
  await page.waitForTimeout(2000);
  const g = graphHelpers(page, h);
  await g.open();
}

export async function run(page, seg, h) {
  const g = graphHelpers(page, h);

  await seg('intro', async () => {
    await h.wait(2600);
    await h.glide(await h.at('#panel-root .rw-graph-palette-cat', 'Video', { exact: true }), 30);
  });

  await seg('luma', async () => {
    await g.add('Video Luma');
    await g.place('Video Luma', 80, 100);
  });

  await seg('region', async () => {
    await g.select('Video Luma');
    const c = await h.at('#panel-root canvas.rw-graph-region-canvas');
    const box = await page.evaluate(() => {
      const b = document.querySelector('#panel-root canvas.rw-graph-region-canvas').getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    });
    await h.drag({ x: box.x + box.w * 0.3, y: box.y + box.h * 0.4 }, { x: box.x + box.w * 0.7, y: box.y + box.h * 0.8 }, 30);
    void c;
  });

  await seg('bind', async () => { await g.bind('zPush', 2); });

  await seg('motion', async () => {
    await g.add('Video Motion');
    await g.place('Video Motion', 80, 320);
    await g.add('Slew');
    await g.place('Slew', 360, 320);
    await g.wire('Video Motion', 'out', 'Slew', 'in');
    await g.select('Slew');
    await g.bind('bloomIntensity', 2.5);
  });

  await seg('library', async () => {
    await h.click('#panel-root .rw-graph-library-btn');
    // The library opens with an animation: wait until the card has a size (a fixed 500 ms was too short under recording load).
    await page.waitForFunction(() => [...document.querySelectorAll('#panel-root .rw-graph-library-card')]
      .some((c) => /Motion-Triggered Glitch/.test(c.textContent || '') && c.getBoundingClientRect().height > 20), null, { timeout: 8000 });
    await h.wait(300);
    await h.glide(await h.at('#panel-root .rw-graph-library-card', 'Motion-Triggered Glitch'), 30);
    await h.wait(1500);
    await h.click('#panel-root .rw-graph-library-btn');
  });

  await seg('watch', async () => {
    await h.click('#panel-root .rw-region-max-btn');
    await h.glide({ x: 980, y: 450 }, 40);
    await h.wait(3000);
  });

  await seg('outro', async () => { await h.drag({ x: 880, y: 450 }, { x: 1080, y: 380 }, 90); });
}
