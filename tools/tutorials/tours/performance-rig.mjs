// Advanced — a live performance setup: layouts, HUD, shortcuts, fly mode,
// performance profiles, output resolution, timeline timecode, popouts.
import { bootPattern } from '../lib/helpers.mjs';

export const lines = [
  { id: 'intro', text: 'On stage you want the picture big and the controls close. The Performance layout maximizes the output.' },
  { id: 'hud', text: 'Press H for the HUD: frame rate, source and render size. Press it again to hide it.' },
  { id: 'back', text: 'Back to the default layout. Bracket keys flip between the panel tabs, and slash jumps to the search box.' },
  { id: 'profile', text: 'The Performance section trades quality for speed. Battery caps the frame rate and drops the heavy effects. Render Scale changes the internal resolution.' },
  { id: 'res', text: 'Virtual Camera sets a fixed output resolution, like full HD for a projector, letterboxed to fit.' },
  { id: 'fly', text: 'Fly mode turns the camera into a free-flying ship: W A S D to move, the mouse to steer, Shift to boost.' },
  { id: 'timecode', text: 'For syncing with video, the Timeline can count in timecode, frames, or samples instead of bars.' },
  { id: 'popout', text: 'And for two screens, Window, Pop Out Output sends the picture to its own window, ready to go fullscreen on a projector, while the controls stay on your laptop.' },
  { id: 'outro', text: 'Last lesson: putting it all together.' },
];
export const poster = 'hud';

export async function pre(page) { await bootPattern(page); }

export async function run(page, seg, h) {
  await seg('intro', async () => {
    await h.wait(2600);
    await h.menu('WINDOW', 'Layout', 'Performance (output maximized)');
    await h.wait(800);
  });

  await seg('hud', async () => {
    await h.glide({ x: 980, y: 500 }, 30);
    await page.keyboard.press('h');
    await h.wait(2500);
    await page.keyboard.press('h');
  });

  await seg('back', async () => {
    await h.menu('WINDOW', 'Layout', 'Default (4-up: bay left, output center)');
    await h.wait(500);
    await h.glide({ x: 980, y: 500 }, 20);
    await page.keyboard.press(']');
    await h.wait(700);
    await page.keyboard.press(']');
    await h.wait(700);
    await page.keyboard.press(']');
    await h.wait(500);
    await page.keyboard.press('/');
    await h.wait(800);
    await page.keyboard.press('Escape');
  });

  await seg('profile', async () => {
    await h.click('#panel-root .rw-tab[data-tab="synth"]');
    await h.section('Performance');
    const S = await h.sec('Performance');
    await h.glide(await h.at(`${S} select`), 25);
    await h.wait(800);
    await h.glide(await h.at('#panel-root [data-param-key="renderScale"] .rw-knob'), 25);
  });

  await seg('res', async () => {
    await h.section('Virtual Camera');
    const S = await h.sec('Virtual Camera');
    await h.glide(await h.row('Resolution', 'select', S).catch(() => h.at(`${S} select`)), 25);
  });

  await seg('fly', async () => {
    await h.glide(await h.row('Mode', 'select', await h.sec('Virtual Camera')), 25);
    await h.wait(1200);
    await h.glide({ x: 980, y: 450 }, 30);
  });

  await seg('timecode', async () => {
    await h.click('#timeline-dock [data-tl="new"]');
    await h.wait(500);
    const sel = await page.evaluate(() => {
      const s = [...document.querySelectorAll('#timeline-dock select')].find((x) => [...x.options].some((o) => /timecode/i.test(o.textContent)));
      const b = s.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, v: [...s.options].find((o) => /timecode/i.test(o.textContent)).value };
    });
    await h.choose(sel, null, sel.v);
    await h.click('#timeline-dock [data-tl="play"]');
    await h.wait(2500);
  });

  await seg('popout', async () => {
    await h.click('#rw-menubar .rw-menubar-item', 'WINDOW', { exact: true });
    await h.wait(400);
    await h.glide(await h.at('.rw-menu li .rw-menu-label', 'Pop Out Output', { exact: true }), 20);
    await h.wait(1800);
    await page.keyboard.press('Escape');
  });

  await seg('outro', async () => { await h.glide({ x: 980, y: 450 }, 40); });
}
