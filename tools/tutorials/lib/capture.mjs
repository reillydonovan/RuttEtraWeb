import fs from 'node:fs';
import path from 'node:path';

/**
 * Capture the page with Chrome's screencast at JPEG quality 100, one file per
 * compositor frame, and return an ffmpeg concat list with each frame held for
 * exactly as long as it was on screen. Playwright's own recorder is VP8 at a
 * low fixed bitrate — fine scan lines turn to noise in it.
 */
export async function startScreencast(ctx, page, work, vp) {
  const dir = path.join(work, 'frames');
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  const writes = [];
  let closed = false;
  cdp.on('Page.screencastFrame', (f) => {
    const file = path.join(dir, `${String(frames.length).padStart(6, '0')}.jpg`);
    frames.push({ t: f.metadata.timestamp * 1000, file });
    if (closed) return;   // a frame that was already in flight when we stopped
    writes.push(fs.promises.writeFile(file, Buffer.from(f.data, 'base64')));
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 100, maxWidth: vp.width, maxHeight: vp.height, everyNthFrame: 1 });
  return {
    async finish(t0, tEnd) {
      await cdp.send('Page.stopScreencast').catch(() => {});
      closed = true;
      cdp.removeAllListeners('Page.screencastFrame');
      await Promise.all(writes);
      await cdp.detach().catch(() => {});
      if (!frames.length) throw new Error('screencast captured no frames');
      const q = (f) => "file '" + f.split(String.fromCharCode(92)).join('/') + "'";
      const lines = [];
      frames.forEach((f, i) => {
        const from = i === 0 ? t0 : f.t;
        const to = i + 1 < frames.length ? frames[i + 1].t : Math.max(tEnd, f.t + 40);
        lines.push(q(f.file), `duration ${Math.max(0.001, (to - from) / 1000).toFixed(4)}`);
      });
      lines.push(q(frames[frames.length - 1].file));   // concat needs the last file repeated
      const list = path.join(work, 'frames.txt');
      fs.writeFileSync(list, lines.join(String.fromCharCode(10)));
      return list;
    },
  };
}

