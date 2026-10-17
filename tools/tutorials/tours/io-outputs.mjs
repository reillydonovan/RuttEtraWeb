// Advanced — I/O outputs: Sonification (with the Sonify graph node), CV Out,
// MIDI clock out. Nothing is switched on that would make sound or voltage:
// the safety stack keeps every output off by default and the video has no
// app audio, so this lesson shows the controls and explains them.
import { bootPattern } from '../lib/helpers.mjs';

export const lines = [
  { id: 'intro', text: 'The synth can send signals out, too. Every output starts switched off and quiet, with a soft start and a limiter, so nothing surprises your speakers or your modular.' },
  { id: 'sonify', text: 'Sonification turns the picture into sound. A voice reads the raster: its brightness, motion and shape set pitch, loudness and filter.' },
  { id: 'mapping', text: 'Each voice parameter has a source and a curve. Pick Graph Node, and a Sonify node in the graph can play the voice directly.' },
  { id: 'safety', text: 'Master volume starts at minus eighteen decibels. Test Tone checks your levels, and Sonification mutes itself whenever a microphone is listening, to avoid feedback.' },
  { id: 'cvout', text: 'CV Out sends control voltage to a modular through a DC-coupled interface. Add an output and choose its type: continuous CV, gate, trigger, clock, or one volt per octave pitch.' },
  { id: 'source', text: 'Its source can be a modulation slot, a graph node, any parameter, the Pattern Generator, MIDI notes, or the tempo clock.' },
  { id: 'clock', text: 'And MIDI Clock Out, in the MIDI section, sends the tempo to drum machines and DAWs.' },
  { id: 'outro', text: 'Inputs and outputs together make the synth one module in a bigger system. Next: stereo and 3D.' },
];
export const poster = 'cvout';

export async function pre(page) { await bootPattern(page); }

export async function run(page, seg, h) {
  await seg('intro', async () => {
    await h.wait(2600);
    await h.click('#panel-root .rw-tab[data-tab="io"]');
    await h.section('Sonification');
  });

  await seg('sonify', async () => {
    const S = await h.sec('Sonification');
    await h.glide(await h.text(S, 'Enable'), 25);
    await h.wait(900);
    await h.glide(await h.text(S, 'Pitch'), 25);
  });

  await seg('mapping', async () => {
    const S = await h.sec('Sonification');
    await h.choose(await h.row('Pitch', 'select', S), null, 'graph');
    await h.wait(600);
    await h.glide(await h.row('Amplitude', 'select', S), 25);
  });

  await seg('safety', async () => {
    const S = await h.sec('Sonification');
    await h.glide(await h.row('Master Volume', '.rw-knob, input', S), 25);
    await h.wait(800);
    await h.glide(await h.at(`${S} .rw-btn`, 'Test Tone'), 25);
  });

  await seg('cvout', async () => {
    await h.section('CV Out');
    const S = await h.sec('CV Out');
    await h.click(`${S} .rw-btn`, '+ Add output', { exact: true });
    await h.wait(700);
    const type = await page.evaluate((s) => {
      const sel = [...document.querySelectorAll(`${s} select`)].find((x) => [...x.options].some((o) => o.textContent === 'Gate'));
      if (!sel) return null;
      sel.scrollIntoView({ block: 'center' });
      const b = sel.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, v: [...sel.options].find((o) => o.textContent === 'Gate').value };
    }, S);
    if (!type) throw new Error('no CV Out type select');
    await h.settle();
    await h.choose(type, null, type.v);
  });

  await seg('source', async () => {
    const S = await h.sec('CV Out');
    const src = await page.evaluate((s) => {
      const sel = [...document.querySelectorAll(`${s} select`)].find((x) => [...x.options].some((o) => /function generator/i.test(o.textContent)));
      if (!sel) return null;
      const b = sel.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, S);
    if (src) await h.glide(src, 25);
    await h.wait(1500);
  });

  await seg('clock', async () => {
    await h.section('MIDI');
    const S = await h.sec('MIDI');
    await h.glide(await h.row('Clock Out', '.rw-toggle', S), 25);
  });

  await seg('outro', async () => { await h.glide({ x: 980, y: 450 }, 40); });
}
