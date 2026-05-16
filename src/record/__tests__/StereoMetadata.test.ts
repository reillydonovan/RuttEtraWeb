/**
 * StereoMetadata injector tests.
 *
 * The injector is a pure function over a Blob — no DOM, no MediaRecorder,
 * no browser-specific behavior — so tests can build a minimal MP4
 * atom tree by hand, run the injector, and inspect the output bytes
 * directly. This validates:
 *
 *   1. Box construction: the 13-byte st3d box has the correct shape
 *      (size = 13, type = 'st3d', version+flags = 0, stereo_mode = 2).
 *   2. Tree surgery: every ancestor's size field is incremented by 13.
 *   3. Failure modes: malformed MP4 returns `failed`; non-MP4 container
 *      returns `skipped`; both return the ORIGINAL blob untouched.
 */

import { describe, expect, it } from 'vitest';
import { injectStereoscopicMetadata } from '../StereoMetadata';

// --------------------------------------------------------------------
// MP4 atom-tree fixtures
// --------------------------------------------------------------------

function u32be(v: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = (v >>> 24) & 0xFF;
  out[1] = (v >>> 16) & 0xFF;
  out[2] = (v >>> 8) & 0xFF;
  out[3] = v & 0xFF;
  return out;
}

function readU32BE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset]     * 0x1000000) +
    (buf[offset + 1] * 0x10000) +
    (buf[offset + 2] * 0x100) +
     buf[offset + 3]
  );
}

/** Wrap a Uint8Array as a Blob-friendly ArrayBuffer to dodge TS 5.6's
 *  `Uint8Array<ArrayBufferLike>` vs `ArrayBufferView<ArrayBuffer>` mismatch
 *  on the BlobPart input type. Copy is cheap at the sizes used here. */
function asBlobPart(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  return buf;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function box(type: string, content: Uint8Array): Uint8Array {
  const total = 8 + content.length;
  return concat([u32be(total), ascii(type), content]);
}

/**
 * Build a minimal MP4 with a single video trak. The video sample
 * entry is a stub `avc1` with no children — st3d gets appended to
 * it. This is the smallest input that exercises the full ancestor
 * chain (moov → trak → mdia → minf → stbl → stsd → avc1).
 */
function buildMinimalMp4(opts?: { handlerType?: string }): Uint8Array {
  const handlerType = opts?.handlerType ?? 'vide';
  // hdlr: version+flags(4) + predefined(4) + handler_type(4) + reserved 3×u32(12) + name "\0"
  const hdlr = box('hdlr', concat([
    new Uint8Array(4),
    new Uint8Array(4),
    ascii(handlerType),
    new Uint8Array(12),
    new Uint8Array([0]),
  ]));
  // avc1 with stub VisualSampleEntry header (we don't need real fields)
  const avc1 = box('avc1', new Uint8Array(78));
  // stsd: version+flags(4) + entry_count=1(4) + avc1 box
  const stsd = box('stsd', concat([
    new Uint8Array(4),
    u32be(1),
    avc1,
  ]));
  const stbl = box('stbl', stsd);
  const minf = box('minf', stbl);
  const mdia = box('mdia', concat([hdlr, minf]));
  const trak = box('trak', mdia);
  const moov = box('moov', trak);
  const ftyp = box('ftyp', concat([ascii('isom'), u32be(0), ascii('isom')]));
  const mdat = box('mdat', new Uint8Array(4));
  return concat([ftyp, moov, mdat]);
}

/** Linear find for a 4-byte tag in the buffer. Returns offset of the
 *  first byte of the tag, or -1 if not found. */
function findTag(buf: Uint8Array, tag: string): number {
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (
      buf[i]     === tag.charCodeAt(0) &&
      buf[i + 1] === tag.charCodeAt(1) &&
      buf[i + 2] === tag.charCodeAt(2) &&
      buf[i + 3] === tag.charCodeAt(3)
    ) return i;
  }
  return -1;
}

// --------------------------------------------------------------------
// Suites
// --------------------------------------------------------------------

describe('injectStereoscopicMetadata — happy path', () => {
  it('injects a well-formed st3d box into a minimal MP4', async () => {
    const mp4 = buildMinimalMp4();
    const blob = new Blob([asBlobPart(mp4)], { type: 'video/mp4' });
    const result = await injectStereoscopicMetadata(blob);

    expect(result.kind).toBe('injected');
    const out = new Uint8Array(await result.blob.arrayBuffer());

    // Output is 13 bytes longer than input.
    expect(out.length).toBe(mp4.length + 13);

    // st3d tag is present.
    const st3dTagAt = findTag(out, 'st3d');
    expect(st3dTagAt).toBeGreaterThan(-1);

    // st3d box layout: size at tag-4, tag at idx, version+flags at idx+4, stereo_mode at idx+8.
    const sizeOffset = st3dTagAt - 4;
    expect(readU32BE(out, sizeOffset)).toBe(13);

    // version+flags = 0
    expect(readU32BE(out, st3dTagAt + 4)).toBe(0);

    // stereo_mode = 2 (side-by-side)
    expect(out[st3dTagAt + 8]).toBe(2);
  });

  it('bumps every ancestor box size by 13', async () => {
    const mp4 = buildMinimalMp4();
    const blob = new Blob([asBlobPart(mp4)], { type: 'video/mp4' });
    const result = await injectStereoscopicMetadata(blob);
    expect(result.kind).toBe('injected');
    const out = new Uint8Array(await result.blob.arrayBuffer());

    // For each ancestor in the chain, the size field should be the
    // original size + 13. Find each tag in BOTH buffers and compare.
    for (const tag of ['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd', 'avc1']) {
      const inAt = findTag(mp4, tag);
      const outAt = findTag(out, tag);
      expect(inAt).toBeGreaterThan(-1);
      expect(outAt).toBeGreaterThan(-1);
      const inSize = readU32BE(mp4, inAt - 4);
      const outSize = readU32BE(out, outAt - 4);
      expect(outSize).toBe(inSize + 13);
    }
  });

  it('preserves the input blob MIME on the injected output', async () => {
    const mp4 = buildMinimalMp4();
    // The WhatWG Blob constructor lowercases the MIME string, so we
    // give it a fully-lowercase value to compare exactly. The injector
    // just round-trips `blob.type` — whatever the Blob ctor stored.
    const blob = new Blob([asBlobPart(mp4)], { type: 'video/mp4;codecs=avc1.42e01f' });
    const result = await injectStereoscopicMetadata(blob);
    expect(result.kind).toBe('injected');
    expect(result.blob.type).toBe('video/mp4;codecs=avc1.42e01f');
  });

  it('encodes top-bottom stereo mode when requested', async () => {
    const mp4 = buildMinimalMp4();
    const blob = new Blob([asBlobPart(mp4)], { type: 'video/mp4' });
    const result = await injectStereoscopicMetadata(blob, { mode: 'top-bottom' });
    expect(result.kind).toBe('injected');
    const out = new Uint8Array(await result.blob.arrayBuffer());
    const st3dTagAt = findTag(out, 'st3d');
    expect(out[st3dTagAt + 8]).toBe(1);
  });
});

describe('injectStereoscopicMetadata — skipped (non-MP4)', () => {
  it('skips WebM and returns the original blob unchanged', async () => {
    const fakeWebm = new Uint8Array([0x1A, 0x45, 0xDF, 0xA3, 0x01, 0x02, 0x03, 0x04]);
    const blob = new Blob([asBlobPart(fakeWebm)], { type: 'video/webm' });
    const result = await injectStereoscopicMetadata(blob);

    expect(result.kind).toBe('skipped');
    if (result.kind === 'skipped') {
      expect(result.reason).toMatch(/video\/webm/);
      expect(result.reason).toMatch(/YouTube Studio/);
      expect(result.blob).toBe(blob); // identity — no copy
    }
  });

  it('skips empty MIME type with a reason', async () => {
    const blob = new Blob([asBlobPart(new Uint8Array([0]))], { type: '' });
    const result = await injectStereoscopicMetadata(blob);
    expect(result.kind).toBe('skipped');
    if (result.kind === 'skipped') {
      expect(result.reason).toMatch(/unknown/);
    }
  });
});

describe('injectStereoscopicMetadata — failed', () => {
  it('returns failed when no moov box is present', async () => {
    // Just a ftyp + mdat — no metadata, can't inject.
    const ftyp = box('ftyp', concat([ascii('isom'), u32be(0), ascii('isom')]));
    const mdat = box('mdat', new Uint8Array(4));
    const buf = concat([ftyp, mdat]);
    const blob = new Blob([asBlobPart(buf)], { type: 'video/mp4' });
    const result = await injectStereoscopicMetadata(blob);
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.reason).toMatch(/moov/i);
      expect(result.blob).toBe(blob); // original preserved
    }
  });

  it('returns failed when no video trak is present', async () => {
    // Build an MP4 with only an audio trak (handler_type='soun').
    const mp4 = buildMinimalMp4({ handlerType: 'soun' });
    const blob = new Blob([asBlobPart(mp4)], { type: 'video/mp4' });
    const result = await injectStereoscopicMetadata(blob);
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.reason).toMatch(/video trak/i);
    }
  });

  it('returns failed on a truncated buffer', async () => {
    const truncated = new Uint8Array([0, 0, 0]); // less than one box header
    const blob = new Blob([asBlobPart(truncated)], { type: 'video/mp4' });
    const result = await injectStereoscopicMetadata(blob);
    expect(result.kind).toBe('failed');
  });
});
