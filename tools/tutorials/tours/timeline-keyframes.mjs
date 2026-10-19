// Lesson 8 — Timeline keyframes: key Z Push at two bars and play.
import { bootPattern } from '../lib/helpers.mjs';

export const lines = [
  { id: 'intro', text: 'The Timeline, along the bottom, plays changes back over time, locked to the tempo.' },
  { id: 'new', text: 'Click the plus button to make a timeline. It is sixteen bars long, at one hundred twenty beats per minute.' },
  { id: 'seek1', text: 'Click the ruler to move the playhead. Bar one.' },
  { id: 'diamond', text: "Every knob has a small diamond above it. Click Z Push's diamond to set a keyframe at the playhead." },
  { id: 'seek3', text: 'Move to bar three, and turn Z Push up. Once a parameter has a lane, every change is keyed automatically.' },
  { id: 'lane', text: 'The lane below draws the curve, in the same numbers as the knob.' },
  { id: 'play', text: 'Press Stop to go back to the start, then Play. The depth rises from bar one to bar three, holds, and the timeline loops.' },
  { id: 'outro', text: 'Key as many parameters as you like. Next: scenes, which capture a whole look at once.' },
];
export const poster = 'play';

export async function pre(page, h) {
  await bootPattern(page);
  await page.click('#panel-root .rw-tab[data-tab="synth"]');
  await h.section('Display Control Unit');
  await h.reveal('#panel-root [data-param-key="zPush"]', null, 'center');
}

async function rulerAt(page, bar) {
  return page.evaluate((n) => {
    const r = document.querySelector('#timeline-dock .rw-tl-ruler').getBoundingClientRect();
    return { x: r.x + n * 60 + 1, y: r.y + r.height / 2 };
  }, bar);
}

export async function run(page, seg, h) {
  await seg('intro', async () => { await h.wait(2600); await h.glide({ x: 980, y: 930 }, 40); });

  await seg('new', async () => {
    await h.click('#timeline-dock [data-tl="new"]');
    await h.check(() => !!document.querySelector('#panel-root [data-param-key="zPush"] > .rw-kf-diamond:not([hidden])'), 'timeline created');
    await h.glide(await h.at('#timeline-dock label', 'BPM'), 25);
    await h.wait(500);
    await h.glide(await h.at('#timeline-dock label', 'BARS'), 25);
  });

  await seg('seek1', async () => { await h.click(await rulerAt(page, 1)); });

  await seg('diamond', async () => {
    await h.click('#panel-root [data-param-key="zPush"] > .rw-kf-diamond');
    await h.check(() => document.querySelectorAll('.rw-tl-lane-row').length > 0, 'lane created');
  });

  await seg('seek3', async () => {
    await h.click(await rulerAt(page, 3));
    await h.wait(500);
    await h.knob(await h.at('#panel-root [data-param-key="zPush"] .rw-knob'), 55, 50);
    await h.check(() => document.querySelectorAll('.rw-tl-lane-pt').length >= 2, 'second point auto-keyed');
  });

  await seg('lane', async () => {
    const pts = await page.evaluate(() => [...document.querySelectorAll('.rw-tl-lane-pt')].map((p) => {
      const b = p.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }));
    for (const p of pts) { await h.glide(p, 30); await h.wait(500); }
  });

  await seg('play', async () => {
    // Back to the start first: playing from the last key would never show the move between keys.
    await h.click('#timeline-dock [data-tl="stop"]');
    await h.check(() => /bar 0\.00/.test(document.querySelector('#timeline-dock')?.textContent ?? ''), 'playhead at the start');
    await h.click('#timeline-dock [data-tl="play"]');
    await h.glide({ x: 980, y: 420 }, 40);
    await h.wait(8000);
  });

  await seg('outro', async () => {});
}
