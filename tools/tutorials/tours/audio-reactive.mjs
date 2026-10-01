// Intermediate — audio-reactive: the Audio section, beat detector, spectrum
// displacement, and an audio-reactive graph patch. Chrome's fake microphone
// (a periodic beep) stands in for a real mic.
import { bootPattern } from '../lib/helpers.mjs';

export const fakeMedia = true;

export const lines = [
  { id: 'intro', text: 'Everything here can react to sound. On the I O tab, the Audio section listens to a microphone, an audio file, or another tab.' },
  { id: 'mic', text: 'Choose Microphone. A test tone stands in for a real mic here. Linear spacing spreads the bands evenly, and the spectrum shows each beep arrive.' },
  { id: 'beat', text: 'Turn on the beat detector. Its light flashes on every hit, and Beat becomes a modulation source.' },
  { id: 'spectrum', text: 'Spectrum to Z displacement lifts each scan line by its own frequency band. Turn up the amount.' },
  { id: 'patch', text: 'Or patch sound anywhere. In Graph mode, the Library has an audio-reactive bloom patch. Load it, and the glow pumps with every beep.' },
  { id: 'classic', text: 'Classic slots can use Audio, a single band, or Beat as their source, too.' },
  { id: 'outro', text: 'Plug in a real mic, or load a song file, and the whole picture plays along. Next: the oscilloscope.' },
];
export const poster = 'spectrum';

export async function pre(page) { await bootPattern(page); }

export async function run(page, seg, h) {
  await seg('intro', async () => {
    await h.wait(2700);
    await h.click('#panel-root .rw-tab[data-tab="io"]');
    await h.section('Audio');
  });

  await seg('mic', async () => {
    const S = await h.sec('Audio');
    await h.choose(await h.row('Source', 'select', S), null, 'mic');
    await h.check(() => /connected/i.test(document.querySelector('#panel-root')?.textContent ?? ''), 'mic connected');
    await h.choose(await h.row('Spacing', 'select', S), null, 'linear');
    await h.glide(await h.at(`${S} canvas.rw-vis`), 30);
    await h.wait(1500);
  });

  await seg('beat', async () => {
    const G = await h.grp('Beat detector');
    await h.click(await h.row('Enable', '.rw-toggle', G));
    await h.wait(400);
    await h.glide(await h.at(`${G} .rw-status-dot, ${G} [class*="pulse"]`).catch(() => ({ x: 1740, y: 600 })), 25);
  });

  await seg('spectrum', async () => {
    const G = await h.grp('Spectrum -> Z displacement');
    await h.click(await h.row('Enable', '.rw-toggle', G));
    await h.wait(300);
    await h.knob(await h.row('Amount', '.rw-knob', G), 50, 40);
    await h.glide({ x: 980, y: 450 }, 40);
    await h.wait(1500);
  });

  await seg('patch', async () => {
    await h.click('#panel-root .rw-tab[data-tab="synth"]');
    await h.section('Modulation');
    await h.click('#panel-root .rw-mod-mode-switch button[data-mode="graph"]');
    await h.wait(900);
    await h.click('#panel-root .rw-graph-library-btn');
    await h.wait(500);
    await h.click('#panel-root .rw-graph-library-card', 'Audio-Reactive Bloom');
    await h.wait(400);
    await h.glide({ x: 980, y: 450 }, 40);
  });

  await seg('classic', async () => {
    await h.click('#panel-root .rw-mod-mode-switch button[data-mode="both"]');
    await h.wait(600);
    await h.glide(await h.at('#panel-root [data-mod-slot="0"] select.rw-mod-slot-src'), 30);
  });

  await seg('outro', async () => { await h.glide({ x: 980, y: 450 }, 40); });
}
