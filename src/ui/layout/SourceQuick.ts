/**
 * The phone's Source sheet leads with four big choices instead of the
 * desktop's capture-settings table: front camera (selfie), back camera,
 * a video from the library, or the built-in pattern. Everything routes
 * through `CaptureDockDeps.quickSource`, i.e. the same start-up paths the
 * boot screen uses — this is a front end, not a second source manager.
 */

import { SettingsStore } from '../../state/Settings';
import type { CaptureDockDeps } from './CaptureDock';
import { aspectForSource } from '../sections/DcuSection';

type Quick = NonNullable<CaptureDockDeps['quickSource']>;

const ic = (d: string) =>
  `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const TILES = [
  { id: 'front',   label: 'Front camera', sub: 'Selfie',   icon: ic('<circle cx="12" cy="9" r="4"/><path d="M4.5 20c1.2-3.6 4-5.2 7.5-5.2s6.3 1.6 7.5 5.2"/>') },
  { id: 'back',    label: 'Back camera',  sub: 'The world', icon: ic('<rect x="3" y="6" width="18" height="13" rx="3"/><circle cx="12" cy="12.5" r="3.2"/><path d="M8 6l1.2-2h5.6L16 6"/>') },
  { id: 'library', label: 'Video',        sub: 'Your library', icon: ic('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.2-2.5z"/>') },
  { id: 'pattern', label: 'Pattern',      sub: 'No camera needed', icon: ic('<path d="M3 8c3-3 6 3 9 0s6 3 9 0M3 14c3-3 6 3 9 0s6 3 9 0M3 20c3-3 6 3 9 0s6 3 9 0"/>') },
] as const;

export function buildSourceQuick(settings: SettingsStore, q: Quick, toast: (m: string) => void): { el: HTMLElement; dispose: () => void } {
  const el = document.createElement('section');
  el.className = 'rw-quicksrc';
  const h = document.createElement('div');
  h.className = 'rw-quicksrc-title';
  h.textContent = 'Start from';
  const grid = document.createElement('div');
  grid.className = 'rw-quicksrc-grid';
  const btns = new Map<string, HTMLButtonElement>();

  for (const t of TILES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rw-quicksrc-tile';
    b.innerHTML = `<span class="rw-quicksrc-ico">${t.icon}</span><span class="rw-quicksrc-lbl">${t.label}</span><span class="rw-quicksrc-sub">${t.sub}</span>`;
    b.addEventListener('click', async () => {
      try {
        if (t.id === 'front') await q.webcam('user');
        else if (t.id === 'back') await q.webcam('environment');
        else if (t.id === 'library') q.library();
        else q.pattern();
      } catch (e) {
        toast(`Couldn't start that source: ${(e as Error).message}`);
      }
      refresh();
    });
    btns.set(t.id, b);
    grid.appendChild(b);
  }

  const refresh = (): void => {
    const kind = q.activeKind();
    const pattern = kind === 'none' && settings.get('patternEnabled');
    const facing = q.facing();
    btns.get('front')!.classList.toggle('active', kind === 'webcam' && facing === 'user');
    btns.get('back')!.classList.toggle('active', kind === 'webcam' && facing === 'environment');
    btns.get('library')!.classList.toggle('active', kind === 'file');
    btns.get('pattern')!.classList.toggle('active', pattern);
  };
  refresh();
  const offs = (['sourceKind', 'cameraFacing', 'patternEnabled'] as const).map((k) => settings.subscribe(k, refresh));

  // ---- Aspect: the raster's shape (the DCU's Aspect value). "Fit picture" matches the
  // camera or video; the rest are fixed shapes — 9:16 fills a portrait phone screen.
  const ah = document.createElement('div');
  ah.className = 'rw-quicksrc-title';
  ah.textContent = 'Aspect';
  const chips = document.createElement('div');
  chips.className = 'rw-quicksrc-aspects';
  const fit = (): number | null => { const s = q.sourceSize(); return s ? aspectForSource(s.w, s.h) : null; };
  const ASPECTS: { id: string; label: string; value: () => number | null }[] = [
    { id: 'fit', label: 'Fit picture', value: fit },
    { id: '4:3', label: '4:3', value: () => 4 / 3 },
    { id: '16:9', label: '16:9', value: () => 16 / 9 },
    { id: '1:1', label: '1:1', value: () => 1 },
    { id: '9:16', label: '9:16', value: () => 9 / 16 },
  ];
  const aspectBtns = new Map<string, HTMLButtonElement>();
  for (const a of ASPECTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rw-quicksrc-aspect';
    b.textContent = a.label;
    b.addEventListener('click', () => {
      const v = a.value();
      if (v == null) { toast('Start a camera or video first — then Fit picture matches its shape.'); return; }
      settings.set('aspect', v);
    });
    aspectBtns.set(a.id, b);
    chips.appendChild(b);
  }
  const refreshAspect = (): void => {
    const cur = settings.get('aspect');
    const near = (v: number | null) => v != null && Math.abs(cur - v) < 0.002;
    // A fixed shape that happens to equal the picture lights only the fixed chip.
    const lit = ASPECTS.slice(1).find((a) => near(a.value()))?.id ?? (near(fit()) ? 'fit' : null);
    for (const [id, b] of aspectBtns) b.classList.toggle('active', id === lit);
  };
  refreshAspect();
  offs.push(settings.subscribe('aspect', refreshAspect));

  el.append(h, grid, ah, chips);
  return { el, dispose: () => { for (const off of offs) off?.(); } };
}
