/**
 * YouTube-compatible stereoscopic metadata injection for MP4 recordings.
 *
 * The box we actually inject is `st3d` (Stereoscopic 3D Video Box) from
 * Google's spatial-media spec — NOT `sv3d` (Spherical Video v2), which
 * was the name in the original feature spec. `sv3d` describes
 * equirectangular / cubemap projection for 360° VR; `st3d` describes
 * frame-packing (mono / top-bottom / side-by-side / stereo-custom) for
 * flat stereoscopic video. YouTube's auto-detection of side-by-side
 * stereo uses `st3d`. See https://github.com/google/spatial-media/blob/
 * master/docs/spherical-video-v2-rfc.md and
 * https://support.google.com/youtube/answer/7278886.
 *
 * `st3d` is a leaf box that lives inside the video sample entry inside
 * `moov.trak.mdia.minf.stbl.stsd.<sample_entry>` (avc1 / hvc1 / vp09 /
 * av01). It carries a 1-byte stereo_mode value:
 *
 *   0 = mono
 *   1 = top-bottom
 *   2 = side-by-side  ← what we write
 *   3 = stereo-custom
 *
 * Total box size is 13 bytes:
 *
 *   uint32  size = 13
 *   ascii   type = 'st3d'
 *   uint32  version<<24 | flags = 0
 *   uint8   stereo_mode
 *
 * Injection means walking the MP4 atom tree, finding the path
 * `moov -> trak(video) -> mdia -> minf -> stbl -> stsd -> avc1/...`,
 * appending the 13-byte `st3d` to the end of the sample entry's
 * children, and updating every ancestor box's size field by +13.
 *
 * No third-party library is used — the spec mentioned mp4box.js (~200KB
 * minified) but mp4box.js doesn't expose a clean API for inserting
 * custom child boxes into sample entries anyway. Hand-walking the atom
 * tree is ~150 lines of pure ES, fits the bundle without bloat, and
 * keeps the failure surface small enough to test exhaustively.
 *
 * On any parse error (truncated buffer, unexpected handler types,
 * 64-bit ancestor sizes, missing required boxes), `injectStereoscopicMetadata`
 * returns `{ kind: 'failed', blob: <original>, reason }` so the caller
 * can surface the failure to the user — Principle 3 demands we not
 * silently drop the metadata. The original recording is always
 * preserved either way; metadata is an additive enhancement.
 */

export type StereoMode = 'side-by-side' | 'top-bottom' | 'stereo-custom';

const STEREO_MODE_CODE: Record<StereoMode, number> = {
  'side-by-side':  2,
  'top-bottom':    1,
  'stereo-custom': 3,
};

/**
 * Three-way result so the caller can distinguish:
 *
 *   - `injected`: MP4 was parsed, st3d added, returned blob is the
 *      new file with metadata. Upload to YouTube → auto-detected.
 *   - `skipped`:  Container wasn't MP4 (WebM, etc.) — there's no
 *      st3d equivalent to inject. The original blob is returned
 *      unchanged. Caller toasts "valid stereo but won't auto-detect
 *      on YouTube" with the YouTube Studio manual-flag instructions.
 *   - `failed`:   We tried but something in the parse / write went
 *      wrong (malformed input, browser variant we don't recognize,
 *      etc.). Original blob returned; reason describes the failure
 *      for the toast.
 */
export type InjectionResult =
  | { kind: 'injected'; blob: Blob }
  | { kind: 'skipped';  blob: Blob; reason: string }
  | { kind: 'failed';   blob: Blob; reason: string };

/**
 * Injector function signature — passed into `CanvasRecorder` as a
 * constructor option so tests can swap in a stub that returns any
 * `InjectionResult` shape without touching the production module.
 */
export type StereoMetadataInjector = (
  blob: Blob,
  opts?: { mode?: StereoMode },
) => Promise<InjectionResult>;

/**
 * Production injector. Pure function — same input always produces the
 * same output. No side effects, no globals read or written.
 */
export const injectStereoscopicMetadata: StereoMetadataInjector = async (
  blob,
  opts,
) => {
  const mode = opts?.mode ?? 'side-by-side';
  // Skip non-MP4 containers — WebM has no equivalent box. Caller
  // handles the user-facing message; we return a structured reason
  // so the toast can be specific.
  if (!isMp4Mime(blob.type)) {
    return {
      kind: 'skipped',
      blob,
      reason: `Container is ${blob.type || 'unknown'} — st3d injection only applies to MP4. ` +
              `The file is still valid side-by-side stereo; flag it as 3D in YouTube Studio manually.`,
    };
  }
  try {
    const input = new Uint8Array(await blob.arrayBuffer());
    const output = injectSt3d(input, STEREO_MODE_CODE[mode]);
    // TS 5.6 narrows Uint8Array's buffer to `ArrayBufferLike` which
    // covers SharedArrayBuffer; BlobPart wants a plain ArrayBuffer.
    // We construct a fresh ArrayBuffer from the bytes — copy is cheap
    // (the buffer was only just allocated above) and the type narrows
    // correctly.
    const outBuf = new ArrayBuffer(output.length);
    new Uint8Array(outBuf).set(output);
    return {
      kind: 'injected',
      blob: new Blob([outBuf], { type: blob.type }),
    };
  } catch (err) {
    return {
      kind: 'failed',
      blob,
      reason: err instanceof Error ? err.message : 'unknown injection error',
    };
  }
};

function isMp4Mime(mime: string): boolean {
  return mime === 'video/mp4' || mime.startsWith('video/mp4;') ||
         mime === 'audio/mp4' || mime.startsWith('audio/mp4;');
}

// --------------------------------------------------------------------
// Atom tree walking
// --------------------------------------------------------------------

interface Atom {
  /** Absolute byte offset of the box's size field. */
  start: number;
  /** Absolute byte offset of the first byte after the box header. */
  contentStart: number;
  /** Absolute byte offset one past the last byte of this box. */
  contentEnd: number;
  /** Total box size in bytes (header + content). */
  size: number;
  /** Header byte count: 8 for normal, 16 for size==1 extended. */
  headerSize: number;
  /** ASCII 4-character box type. */
  type: string;
}

function readU32BE(buf: Uint8Array, offset: number): number {
  return (
    (buf[offset]     * 0x1000000) +
    (buf[offset + 1] * 0x10000) +
    (buf[offset + 2] * 0x100) +
     buf[offset + 3]
  );
}

function writeU32BE(buf: Uint8Array, offset: number, value: number): void {
  buf[offset]     = (value >>> 24) & 0xFF;
  buf[offset + 1] = (value >>> 16) & 0xFF;
  buf[offset + 2] = (value >>> 8) & 0xFF;
  buf[offset + 3] = value & 0xFF;
}

function readType(buf: Uint8Array, offset: number): string {
  return String.fromCharCode(buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]);
}

/**
 * Parse the immediate child atoms inside the byte range [start, end).
 * Walks linearly; bails on size==0 or truncated buffers. Handles the
 * size==1 (64-bit extended) case for completeness — important for
 * `mdat` which may exceed 4GB — though our metadata path (moov.trak.
 * mdia.minf.stbl.stsd) never uses the extended form in practice.
 */
function readAtoms(buf: Uint8Array, start: number, end: number): Atom[] {
  const out: Atom[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    const size = readU32BE(buf, pos);
    const type = readType(buf, pos + 4);
    let totalSize = size;
    let headerSize = 8;
    if (size === 1) {
      if (pos + 16 > end) break;
      const hi = readU32BE(buf, pos + 8);
      const lo = readU32BE(buf, pos + 12);
      // Number is safe up to 2^53; for our purposes mdat can be huge
      // but we never descend into it.
      totalSize = hi * 0x100000000 + lo;
      headerSize = 16;
    } else if (size === 0) {
      totalSize = end - pos;
    }
    if (totalSize < headerSize || pos + totalSize > end) break;
    out.push({
      start: pos,
      contentStart: pos + headerSize,
      contentEnd: pos + totalSize,
      size: totalSize,
      headerSize,
      type,
    });
    pos += totalSize;
  }
  return out;
}

function findChild(atoms: Atom[], type: string): Atom | undefined {
  return atoms.find((a) => a.type === type);
}

/**
 * Resolve the full path to the video track's first sample entry. The
 * returned array contains, in order, the ancestors whose `size` fields
 * we must bump after inserting the new child:
 *
 *   [moov, trak, mdia, minf, stbl, stsd, sampleEntry]
 *
 * Skips audio / subtitle / metadata traks by checking the `hdlr`
 * handler_type — only `vide` traks are eligible.
 */
function findVideoSampleEntryPath(buf: Uint8Array): Atom[] {
  const top = readAtoms(buf, 0, buf.length);
  const moov = findChild(top, 'moov');
  if (!moov) throw new Error('moov box not found');

  const moovChildren = readAtoms(buf, moov.contentStart, moov.contentEnd);
  const traks = moovChildren.filter((a) => a.type === 'trak');
  if (traks.length === 0) throw new Error('no trak boxes inside moov');

  for (const trak of traks) {
    const trakChildren = readAtoms(buf, trak.contentStart, trak.contentEnd);
    const mdia = findChild(trakChildren, 'mdia');
    if (!mdia) continue;

    const mdiaChildren = readAtoms(buf, mdia.contentStart, mdia.contentEnd);
    const hdlr = findChild(mdiaChildren, 'hdlr');
    if (!hdlr) continue;
    // hdlr content layout:
    //   uint32 version+flags
    //   uint32 predefined (0)
    //   uint32 handler_type (4 chars: 'vide', 'soun', ...)
    if (hdlr.contentEnd - hdlr.contentStart < 12) continue;
    const handlerType = readType(buf, hdlr.contentStart + 8);
    if (handlerType !== 'vide') continue;

    const minf = findChild(mdiaChildren, 'minf');
    if (!minf) throw new Error('minf not found in video trak');
    const minfChildren = readAtoms(buf, minf.contentStart, minf.contentEnd);
    const stbl = findChild(minfChildren, 'stbl');
    if (!stbl) throw new Error('stbl not found in video trak');
    const stblChildren = readAtoms(buf, stbl.contentStart, stbl.contentEnd);
    const stsd = findChild(stblChildren, 'stsd');
    if (!stsd) throw new Error('stsd not found in video trak');

    // stsd content layout: 4 bytes version+flags, 4 bytes entry_count,
    // then the entry boxes themselves (avc1 / hvc1 / vp09 / av01 / ...).
    if (stsd.contentEnd - stsd.contentStart < 8) {
      throw new Error('stsd content too small for header');
    }
    const entries = readAtoms(buf, stsd.contentStart + 8, stsd.contentEnd);
    if (entries.length === 0) throw new Error('stsd has no sample entries');
    const sampleEntry = entries[0];

    // We update uint32 size fields only. If any ancestor uses the
    // 64-bit extended size (size==1) we can't safely patch in place
    // — bail with a specific error so the caller's toast is helpful.
    for (const node of [moov, trak, mdia, minf, stbl, stsd, sampleEntry]) {
      if (node.headerSize !== 8) {
        throw new Error(`64-bit extended size on '${node.type}' box not supported`);
      }
    }
    return [moov, trak, mdia, minf, stbl, stsd, sampleEntry];
  }
  throw new Error('no video trak with handler_type=vide found');
}

/**
 * Build the 13-byte `st3d` box for the given stereo_mode value. The
 * stereo_mode is the only variable byte — version+flags are zero.
 */
function buildSt3dBox(stereoMode: number): Uint8Array {
  const box = new Uint8Array(13);
  writeU32BE(box, 0, 13);
  // 'st3d' = 0x73, 0x74, 0x33, 0x64
  box[4] = 0x73; box[5] = 0x74; box[6] = 0x33; box[7] = 0x64;
  // version (1 byte) + flags (3 bytes) all zero — leave as-is.
  box[12] = stereoMode & 0xFF;
  return box;
}

/**
 * Splice an `st3d` box into the video sample entry. Returns a new
 * Uint8Array — the input is not mutated. Caller wraps the result
 * back into a Blob with the original MIME.
 */
function injectSt3d(input: Uint8Array, stereoMode: number): Uint8Array {
  const path = findVideoSampleEntryPath(input);
  const sampleEntry = path[path.length - 1];
  // Append as a sibling to the sample entry's existing children
  // (avcC, btrt, colr, etc.). YouTube doesn't care about ordering
  // and "append" minimizes disturbance to the existing layout.
  const insertOffset = sampleEntry.contentEnd;
  const st3d = buildSt3dBox(stereoMode);

  const out = new Uint8Array(input.length + st3d.length);
  out.set(input.subarray(0, insertOffset), 0);
  out.set(st3d, insertOffset);
  out.set(input.subarray(insertOffset), insertOffset + st3d.length);

  // Bump every ancestor size by 13. All ancestors live before the
  // insertion point, so their `start` offsets are unchanged in the
  // output buffer.
  for (const node of path) {
    const oldSize = readU32BE(out, node.start);
    writeU32BE(out, node.start, oldSize + st3d.length);
  }
  return out;
}
