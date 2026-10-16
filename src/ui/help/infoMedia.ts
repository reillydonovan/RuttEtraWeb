/**
 * Where the ⓘ panels' pictures and clips come from.
 *
 * `public/info/manifest.json` maps a media key (infoContent.ts `mediaKeys`) to
 * the files that show that unit: a short looping clip of the effect on the live
 * picture and/or a screenshot of the controls themselves. Both are generated
 * by `tools/tutorials/info-media.mjs` from the real app, so they can't drift
 * from the GUI they describe (re-run it after a GUI change). Fetched lazily,
 * once; a missing manifest or key just means the panel is text-only.
 */

export interface InfoMediaEntry {
  /** Looping clip (MP4, no audio) of the effect. */
  clip?: string;
  /** Screenshot of the controls. */
  shot?: string;
  caption?: string;
  shotCaption?: string;
}

let manifest: Promise<Record<string, InfoMediaEntry>> | null = null;

/** Resolve a manifest-relative path against the MAIN window (a popout's base URL is about:blank). */
function abs(rel: string): string {
  return new URL(rel, window.location.href).href;
}

export async function infoMedia(key: string): Promise<InfoMediaEntry | null> {
  manifest ??= fetch(abs('info/manifest.json'), { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, InfoMediaEntry>>) : {}))
    .catch(() => ({}));
  const e = (await manifest)[key];
  if (!e) return null;
  return {
    ...e,
    clip: e.clip ? abs(`info/${e.clip}`) : undefined,
    shot: e.shot ? abs(`info/${e.shot}`) : undefined,
  };
}
