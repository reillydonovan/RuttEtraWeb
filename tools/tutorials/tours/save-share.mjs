// Intermediate — saving (presets, projects), recording a clip, sharing live.
import { bootPattern } from '../lib/helpers.mjs';

// Force the download fallbacks: the native file pickers can't be recorded.
export const initScripts = ['window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined;'];
export const promptAnswer = 'Night Drive';

export const lines = [
  { id: 'intro', text: 'Three ways to keep your work: presets save a look, projects save everything, and recordings save the picture.' },
  { id: 'preset', text: 'In Presets, name the current look and click Save Current. It joins your saved presets, ready to load later.' },
  { id: 'reload', text: 'Try another look, then load yours back from the saved list.' },
  { id: 'project', text: 'Project, at the top of the Synth tab, saves the whole workspace: settings, presets, timelines and patches. Save As asks for a name, and the file downloads.' },
  { id: 'record', text: 'Record captures the output as a video file. Start, let it run, then Stop and Download.' },
  { id: 'share', text: "Share broadcasts the output live. Start Broadcast gives you a link and a QR code; anyone who opens it watches in their browser." },
  { id: 'whip', text: 'WHIP output streams to OBS, MediaMTX or Cloudflare instead, for bigger audiences.' },
  { id: 'outro', text: 'That covers the intermediate course. The advanced lessons start with deep patching.' },
];
export const poster = 'share';

export async function pre(page) { await bootPattern(page); await page.click('#panel-root .rw-tab[data-tab="synth"]'); }

export async function run(page, seg, h) {
  await seg('intro', async () => { await h.wait(2700); await h.section('Presets'); });

  await seg('preset', async () => {
    const P = await h.sec('Presets');
    await h.click(`${P} input.rw-text[placeholder="preset name"]`);
    await page.keyboard.type('Night Drive', { delay: 90 });
    await h.click(`${P} .rw-btn`, 'Save Current', { exact: true });
  });

  await seg('reload', async () => {
    const P = await h.sec('Presets');
    await h.click(`${P} .rw-preset-chip`, 'Amber Terminal', { exact: true });
    await h.wait(1500);
    const sel = await h.row('Saved', 'select', P);
    const v = await page.evaluate((p) => {
      const r = [...document.querySelectorAll(`${p} .rw-row`)].find((e) => e.querySelector('.rw-label')?.textContent.trim() === 'Saved');
      return [...r.querySelector('select').options].find((o) => o.textContent.trim() === 'Night Drive')?.value ?? null;
    }, P);
    if (v == null) throw new Error('saved preset not listed');
    await h.choose(sel, null, v);
    const btns = await page.evaluate((p) => {
      const sel = [...document.querySelectorAll(`${p} .rw-row`)].find((r) => r.querySelector('.rw-label')?.textContent.trim() === 'Saved');
      const btn = [...sel.parentElement.querySelectorAll('.rw-btn')].find((b) => b.textContent.trim() === 'Load');
      const r = btn.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, P);
    await h.click(btns);
    await h.check(() => document.querySelector('#panel-root select[data-param-key="colorMode"]')?.value !== 'phosphorAmber', 'user preset reloaded');
  });

  await seg('project', async () => {
    await h.section('Project');
    const download = page.waitForEvent('download', { timeout: 15000 });
    await h.click(`${await h.sec('Project')} .rw-btn`, 'Save As…', { exact: true });
    await download;
    await h.wait(600);
  });

  await seg('record', async () => {
    await h.section('Record');
    const R = await h.sec('Record');
    await h.click(`${R} .rw-btn`, 'Start Recording', { exact: true });
    await h.drag({ x: 880, y: 450 }, { x: 1080, y: 400 }, 60);
    await h.wait(1500);
    const download = page.waitForEvent('download', { timeout: 20000 });
    await h.click(`${R} .rw-btn`, 'Stop & Download', { exact: true });
    await download;
  });

  await seg('share', async () => {
    await h.section('Share');
    const S = await h.sec('Share');
    await h.click(`${S} .rw-btn`, 'Start Broadcast', { exact: true });
    // Needs the public PeerJS broker; show the QR if it comes up in time.
    for (let i = 0; i < 30; i++) {
      if (await page.evaluate((s) => !!document.querySelector(`${s} .rw-qr canvas`)?.offsetWidth, S)) break;
      await h.wait(200);
    }
    await h.reveal(`${S} .rw-qr`, null, 'center').catch(() => {});
    await h.wait(1500);
  });

  await seg('whip', async () => {
    const S = await h.sec('Share');
    await h.click(`${S} .rw-btn`, 'Stop', { exact: true }).catch(() => {});
    await h.glide(await h.at(`${S} .rw-btn`, 'Start WHIP', { exact: true }), 30);
  });

  await seg('outro', async () => { await h.glide({ x: 980, y: 450 }, 40); });
}
