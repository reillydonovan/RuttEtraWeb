// Lesson 1 — First look: PATTERN source, orbit, Z Push, a first Patch Bay patch.

export const lines = [
  { id: 'intro', text: 'This is Rutt Etra Web, a browser recreation of the 1973 Rutt Etra scan processor, an analog video synthesizer.' },
  { id: 'pattern', text: 'No camera needed for this tour. Click Pattern, and the built-in pattern generator becomes the picture.' },
  { id: 'scanlines', text: 'The image is drawn as horizontal scan lines. Brighter areas push the lines toward you, so the picture becomes a landscape.' },
  { id: 'orbit', text: 'Drag in the render window to orbit the virtual camera around it.' },
  { id: 'search', text: 'The Controls panel on the right holds every parameter. Type in the search box to find one. Here, Z Push, the depth of the raster.' },
  { id: 'knob', text: 'Drag a knob up to turn it up. More push, deeper relief.' },
  { id: 'bay', text: 'The Patch Bay on the left is the same instrument, laid out as a hardware faceplate. Maximize it to see every jack.' },
  { id: 'addnode', text: 'Right-click empty space to add a node. We will add an LFO, a slow oscillator.' },
  { id: 'wire', text: "Drag from the LFO's output jack onto Z Push's input. The cable is the patch." },
  { id: 'result', text: 'Restore the window, and the raster now breathes on its own.' },
  { id: 'outro', text: 'Pick a source, shape it, and patch movement into it. Next, we will learn our way around the windows.' },
];
export const poster = 'result';

export async function run(page, seg, h) {
  await seg('intro', async () => {
    await h.wait(2600);
    await h.glide(await h.at('#boot-webcam'), 40);
    await h.glide(await h.at('#boot-file'), 40);
  });

  await seg('pattern', async () => {
    await h.wait(1200);
    await h.click('#boot-pattern');
  });

  await seg('scanlines', async () => { await h.glide({ x: 980, y: 450 }, 60); });

  await seg('orbit', async () => {
    await h.drag({ x: 900, y: 450 }, { x: 1150, y: 360 }, 90);
    await h.wait(400);
    await h.drag({ x: 1150, y: 360 }, { x: 950, y: 430 }, 90);
  });

  await seg('search', async () => {
    await h.click('#panel-root input[placeholder^="Search"]');
    await page.keyboard.type('z push', { delay: 110 });
  });

  await seg('knob', async () => {
    await h.knob(await h.at('#panel-root [data-param-key="zPush"] .rw-knob'), 55, 70);
  });

  await seg('bay', async () => { await h.click('#rw-left-shell .rw-region-max-btn'); });

  await seg('addnode', async () => {
    await h.click(await h.emptyBaySpot(), null, { button: 'right' });
    await h.wait(700);
    await h.click('.rw-pb-addnode-menu .rw-graph-palette-item', 'LFO', { exact: true, steps: 25 });
  });

  await seg('wire', async () => {
    // Spawning switches the board to free layout (adds pan headroom), so the
    // new module lands low. Glide the board until it and Z Push both show.
    await page.evaluate(() => {
      const bay = document.querySelector('.rw-patchbay');
      const mod = [...document.querySelectorAll('.rw-pb-graphnode')].pop();
      const dy = mod.getBoundingClientRect().bottom - (innerHeight - 30);
      if (dy > 0) bay.scrollBy({ top: dy, behavior: 'smooth' });
    });
    await h.wait(900);
    const out = await h.at('.rw-pb-graphnode .rw-rack-jack--out');
    const zIn = await zPushIn(page);
    await h.drag(out, zIn, 80);
  });

  await seg('result', async () => {
    await h.click('#rw-left-shell .rw-region-max-btn');
    await h.wait(400);
    await h.glide({ x: 1000, y: 820 }, 40);
  });

  await seg('outro', async () => {});
}

/** The Z Push IN jack on the Patch Bay faceplate. */
export async function zPushIn(page) {
  return page.evaluate(() => {
    const c = [...document.querySelectorAll('.rw-patchbay .rw-pb-cell-top')]
      .find((e) => e.textContent.trim().startsWith('Z Push') && e.getBoundingClientRect().width > 0);
    const b = c.querySelector('.rw-rack-jack--in').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
}
