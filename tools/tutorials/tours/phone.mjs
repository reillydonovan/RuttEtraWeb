// Lesson 4 — On your phone: the camera-style layout (recorded as a 540x1170 portrait phone).

export const viewport = { width: 540, height: 1170 };
export const appQuery = '?layout=compact';
export const touch = true;      // paint a fingertip, not an arrow
export const fakeMedia = true;  // Chrome's fake camera: a moving test pattern
// Desktop Chrome would open the OS share dialog from the shutter; a phone
// shows its own share sheet, which a screen recording can't capture — so the
// lesson saves to the device instead, and the narration says where Share is.
export const initScripts = ['Object.defineProperty(Navigator.prototype, "canShare", { value: undefined, configurable: true });'];

export const lines = [
  { id: 'intro', text: 'On a phone, Rutt Etra Web turns into a camera. The picture fills the screen, and the controls float over it.' },
  { id: 'source', text: 'Pick a source. Webcam is the front camera on a phone, so this is a selfie. You can also use the back camera, a video from your library, or the pattern with no camera at all.' },
  { id: 'looks', text: 'Swipe the looks along the bottom, and tap one. Each look is a whole color and feel, applied in one tap.' },
  { id: 'orbit', text: 'Drag on the picture to orbit around it.' },
  { id: 'flip', text: 'The flip button swaps between the front and back camera.' },
  { id: 'photo', text: 'In Photo mode, the shutter saves a picture. On a phone, it opens your share sheet, so you can send it straight to a friend.' },
  { id: 'video', text: 'Switch to Video, and the shutter records. Tap it again to stop, and the clip is saved, with a Share button.' },
  { id: 'source-tab', text: 'The tabs open the real controls. Source starts with the same four choices: front camera, back camera, your library, or the pattern.' },
  { id: 'shape', text: 'Shape holds the scan processor: size, position, depth and rotation. Drag any bar to change it, and watch the picture behind the sheet.' },
  { id: 'more', text: 'More has presets, recording options, sharing, and the manual.' },
  { id: 'outro', text: 'Turn the phone sideways, and the shutter moves to the edge. The Patch Bay and Timeline are on the desktop. Everything you save opens in either place.' },
];
export const poster = 'looks';

export async function run(page, seg, h) {
  await seg('intro', async () => { await h.wait(2800); });

  await seg('source', async () => {
    await h.glide(await h.at('#boot-pattern'), 25);
    await h.glide(await h.at('#boot-webcam'), 25);
    await h.wait(400);
    await h.click('#boot-webcam');
    await h.check(() => (document.getElementById('src-video')?.readyState ?? 0) >= 2, 'camera playing');
    await h.wait(1500);
  });

  await seg('looks', async () => {
    await page.evaluate(() => document.querySelector('.rw-looks').scrollTo({ left: 260, behavior: 'smooth' }));
    await h.wait(1100);
    await h.click('.rw-look', 'Amber Terminal', { exact: true });
    await h.check(() => document.querySelector('.rw-look.active')?.textContent === 'Amber Terminal', 'look applied');
    await h.wait(1400);
    await page.evaluate(() => document.querySelector('.rw-looks').scrollTo({ left: 420, behavior: 'smooth' }));
    await h.wait(900);
    await h.click('.rw-look', 'Wireframe', { exact: true });
    await h.wait(900);
  });

  await seg('orbit', async () => {
    await h.drag({ x: 380, y: 520 }, { x: 170, y: 440 }, 70);
    await h.wait(300);
    await h.drag({ x: 170, y: 440 }, { x: 330, y: 560 }, 70);
  });

  await seg('flip', async () => {
    await h.click('.rw-cap-flip');
    await h.check(() => !!document.querySelector('#capture-dock')?.dataset.facing, 'flipped');
    await h.wait(1500);
  });

  await seg('photo', async () => {
    await h.click('.rw-shutter');
    await h.check(() => /Photo saved/.test(document.querySelector('#rw-toast-host')?.textContent ?? ''), 'photo saved');
    await h.wait(1500);
  });

  await seg('video', async () => {
    await h.click('.rw-cap-mode button', 'Video', { exact: true });
    await h.wait(500);
    await h.click('.rw-shutter');
    await h.check(() => document.querySelector('#capture-dock')?.classList.contains('recording'), 'recording');
    await h.wait(3200);
    await h.click('.rw-shutter');
    await h.check(() => /Video saved/.test(document.querySelector('#rw-toast-host')?.textContent ?? ''), 'video saved');
    await h.wait(1000);
  });

  await seg('source-tab', async () => {
    await h.click('#tab-bar [data-tab="source"]');
    await h.check(() => !!document.querySelector('.rw-quicksrc'), 'source sheet');
    await h.glide(await h.at('.rw-quicksrc-tile', 'Back camera'), 25);
    await h.wait(900);
    await h.glide(await h.at('.rw-quicksrc-tile', 'Pattern'), 20);
  });

  await seg('shape', async () => {
    await h.click('.rw-sheet-close');
    await h.wait(500);
    await h.click('#tab-bar [data-tab="synth"]');
    await h.check(() => !!document.querySelector('.rw-sheet-body .rw-slider-scrub'), 'shape sheet');
    const bar = await h.at('.rw-sheet-body .rw-slider-scrub');
    const w = await page.evaluate(() => document.querySelector('.rw-sheet-body .rw-slider-scrub').getBoundingClientRect().width);
    await h.drag({ x: bar.x, y: bar.y }, { x: bar.x + w * 0.38, y: bar.y }, 40);
    await h.wait(700);
    await h.drag({ x: bar.x + w * 0.38, y: bar.y }, { x: bar.x - w * 0.3, y: bar.y }, 40);
    await h.wait(700);
  });

  await seg('more', async () => {
    await h.click('.rw-sheet-close');
    await h.wait(500);
    await h.click('#tab-bar [data-tab="more"]');
    await h.check(() => !!document.querySelector('.rw-sheet-body .rw-preset-chip'), 'more sheet');
    await h.wait(1200);
  });

  await seg('outro', async () => {
    await h.click('.rw-sheet-close');
    await h.glide({ x: 270, y: 560 }, 30);
  });
}
