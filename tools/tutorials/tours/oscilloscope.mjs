// Intermediate — the Oscilloscope pattern: draw any signal as a trace.
export const fakeMedia = true;

export const lines = [
  { id: 'intro', text: 'The Pattern Generator has an Oscilloscope kind: it draws a signal as a glowing trace. Turn it on over the camera, set Kind to Oscilloscope, and Blend to Add.' },
  { id: 'thick', text: 'A thin trace barely lifts the raster, so make it thick. Now it rides across the picture as a ridge.' },
  { id: 'source', text: "Set the scope's source to Classic Slot, and its reference to one: modulation slot one." },
  { id: 'slot', text: 'Switch slot one on. Its sine wave is drawn live.' },
  { id: 'square', text: 'Change the waveform to a square wave, and the trace snaps between two levels.' },
  { id: 'sweep', text: 'Sweep sets how fast the trace crosses the screen. Persist sets how long it glows.' },
  { id: 'other', text: 'The scope can also draw audio, a graph node, any parameter, or the beat pulse.' },
  { id: 'outro', text: 'A scope as a video source: any signal in the synth can become the picture. Next: deeper looks.' },
];
export const poster = 'sweep';

export async function pre(page, h) {
  await page.click('#boot-webcam');
  await page.waitForTimeout(2000);
  await h.wait(300);
}

async function kindSelect(page) {
  return page.evaluate(() => {
    const g = [...document.querySelectorAll('#panel-root .rw-group')].find((e) => e.querySelector('.rw-group-head')?.textContent.trim() === 'Pattern Generator');
    g.scrollIntoView({ block: 'start' });
    const r = [...g.querySelectorAll('.rw-row')].find((e) => e.querySelector('.rw-label')?.textContent.trim() === 'Kind');
    const b = r.querySelector('select').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
}

const S = '#panel-root [data-mod-slot="0"]';

export async function run(page, seg, h) {
  await seg('intro', async () => {
    await h.wait(2700);
    await h.reveal('#panel-root .rw-toggle[data-param-key="patternEnabled"]', null, 'center');
    await h.click('#panel-root .rw-toggle[data-param-key="patternEnabled"]');
    await h.choose(await kindSelect(page), null, 'oscilloscope');
    await h.choose(await h.at('#panel-root select[data-param-key="patternBlendMode"]'), null, 'add');
  });

  await seg('thick', async () => {
    await h.reveal('#panel-root [data-param-key="patternScopeThickness"]', null, 'center');
    await h.knob(await h.at('#panel-root [data-param-key="patternScopeThickness"] .rw-knob'), 120, 50);
    await h.knob(await h.at('#panel-root [data-param-key="patternBrightness"] .rw-knob').catch(() => h.at('#panel-root [data-param-key="patternScopeThickness"] .rw-knob')), 20, 30);
    await h.glide({ x: 980, y: 450 }, 40);
  });

  await seg('source', async () => {
    await h.choose(await h.at('#panel-root select[data-param-key="patternScopeSourceKind"]'), null, 'classic-slot');
    await h.wait(300);
    const ref = await h.row('Ref', 'input');
    await h.click(ref);
    await page.keyboard.press('Control+A');
    await page.keyboard.type('1', { delay: 120 });
    await page.keyboard.press('Enter');
  });

  await seg('slot', async () => {
    await h.section('Modulation');
    await h.click(`${S} label.rw-mod-slot-en`);
    await h.glide({ x: 980, y: 450 }, 40);
  });

  await seg('square', async () => {
    await h.choose(await h.at(`${S} select.rw-mod-slot-src`), null, 'square');
    await h.glide({ x: 980, y: 450 }, 40);
  });

  await seg('sweep', async () => {
    await h.reveal('#panel-root [data-param-key="patternScopeSweep"]', null, 'center');
    await h.knob(await h.at('#panel-root [data-param-key="patternScopeSweep"] .rw-knob'), -40, 40);
    await h.wait(500);
    await h.knob(await h.at('#panel-root [data-param-key="patternScopePersist"] .rw-knob'), 50, 40);
    await h.glide({ x: 980, y: 450 }, 40);
  });

  await seg('other', async () => {
    await h.glide(await h.at('#panel-root select[data-param-key="patternScopeSourceKind"]'), 30);
  });

  await seg('outro', async () => { await h.drag({ x: 880, y: 450 }, { x: 1080, y: 380 }, 90); });
}
