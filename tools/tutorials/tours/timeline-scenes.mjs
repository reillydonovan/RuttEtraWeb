// Lesson 9 — Timeline scenes: snapshot two looks and play between them.
import { bootPattern } from '../lib/helpers.mjs';

export const lines = [
  { id: 'intro', text: 'Scenes capture every setting at once. The timeline blends from one scene to the next.' },
  { id: 'scene1', text: 'Double-click the Scenes track near the start, to capture the current look.' },
  { id: 'change', text: 'Now change the look. Apply the Amber Terminal preset, and push the depth.' },
  { id: 'scene2', text: 'Double-click at bar four, to capture the second scene.' },
  { id: 'play', text: 'Rewind, and press Play. The picture travels from the first look to the second.' },
  { id: 'menu', text: "Right-click a scene marker to preview it, replace its snapshot, or change its easing." },
  { id: 'outro', text: 'Keyframes and scenes work together on one timeline. Next: the Patch Bay.' },
];
export const poster = 'play';

export async function pre(page, h) {
  await bootPattern(page);
  await page.click('#panel-root .rw-tab[data-tab="synth"]');
  await page.click('#timeline-dock .rw-tl-header button.rw-btn:text-is("+ NEW")');
  await h.section('Presets');
}

async function trackAt(page, bar) {
  return page.evaluate((n) => {
    const r = document.querySelector('#timeline-dock .rw-tl-ruler').getBoundingClientRect();
    const t = document.querySelector('#timeline-dock .rw-tl-track').getBoundingClientRect();
    return { x: r.x + n * 60, y: t.y + t.height / 2 };
  }, bar);
}

export async function run(page, seg, h) {
  await seg('intro', async () => { await h.wait(2700); await h.glide(await h.at('#timeline-dock .rw-tl-track-label'), 40); });

  await seg('scene1', async () => {
    const p = await trackAt(page, 0.25);
    await h.glide(p);
    await page.mouse.dblclick(p.x, p.y);
    await h.check(() => document.querySelectorAll('.rw-tl-kf').length === 1, 'scene 1');
  });

  await seg('change', async () => {
    await h.click('#panel-root .rw-preset-chip', 'Amber Terminal', { exact: true });
    await h.wait(900);
    await h.section('Display Control Unit', { scrollOnly: true });
    await h.reveal('#panel-root [data-param-key="zPush"]', null, 'center');
    await h.knob(await h.at('#panel-root [data-param-key="zPush"] .rw-knob'), 60, 50);
  });

  await seg('scene2', async () => {
    const p = await trackAt(page, 4);
    await h.glide(p);
    await page.mouse.dblclick(p.x, p.y);
    await h.check(() => document.querySelectorAll('.rw-tl-kf').length === 2, 'scene 2');
  });

  await seg('play', async () => {
    await h.click('#timeline-dock .rw-tl-header button.rw-btn', 'STOP', { exact: true });
    await h.wait(300);
    await h.click('#timeline-dock .rw-tl-header button.rw-btn', 'PLAY', { exact: true });
    await h.glide({ x: 980, y: 420 }, 40);
    await h.wait(7000);
    await h.click('#timeline-dock .rw-tl-header button.rw-btn', 'PAUSE', { exact: true });
  });

  await seg('menu', async () => {
    const kf = await h.at('#timeline-dock .rw-tl-kf');
    await h.click(kf, null, { button: 'right' });
    await h.wait(2600);
    await page.keyboard.press('Escape');
    await h.click({ x: 980, y: 990 });
  });

  await seg('outro', async () => {});
}
