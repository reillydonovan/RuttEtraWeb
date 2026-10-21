#!/usr/bin/env node
// Contact sheet of a stills directory, in manifest order (left to right, top to bottom).
//
//   node tools/copilot/contact.mjs --dir <stills dir> [--out <dir>/contact.png] [--cols 6] [--tile 192] [--max 60]
//
// ffmpeg ($FFMPEG, default ffmpeg on PATH) tiles the PNGs; a cell left over at the end is black.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const dir = opt('dir') && resolve(opt('dir'));
if (!dir) { console.error('usage: contact.mjs --dir <stills dir> [--out file.png] [--cols 6] [--tile 192] [--max 60]'); process.exit(2); }
const out = resolve(opt('out', join(dir, 'contact.png')));
const cols = Number(opt('cols', 6)), tile = Number(opt('tile', 192)), max = Number(opt('max', 60));

const ids = readFileSync(join(dir, 'manifest.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).id).slice(0, max);
const files = ids.map((id) => join(dir, `${id}.png`)).filter((f) => existsSync(f));
if (!files.length) throw new Error(`no stills listed in ${join(dir, 'manifest.jsonl')}`);
const rows = Math.ceil(files.length / cols);
const list = join(tmpdir(), `contact-${process.pid}.txt`);
writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n');
try {
  execFileSync(process.env.FFMPEG ?? 'ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list,
    '-vf', `scale=${tile}:${tile}:flags=area,tile=${cols}x${rows}:padding=2:color=0x202020`, '-frames:v', '1', out], { stdio: 'inherit' });
} finally {
  rmSync(list, { force: true });
}
console.log(`${out}: ${files.length} stills, ${cols}x${rows}`);
