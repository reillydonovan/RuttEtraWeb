/**
 * Entry point for `tutorials.html` — the narrated video course.
 *
 * Like the About page, this loads NO synth runtime (no three.js, Web Audio,
 * PeerJS); `scripts/check-about-bundle.cjs` checks this chunk too. The
 * course outline comes from `tutorials/manifest.json`, which
 * `tools/tutorials/build.mjs` generates from its curriculum alongside the
 * videos (one source for lesson order, titles, chapters). The MP4s are not
 * in git; they're uploaded to the same /tutorials/ folder on the server.
 */

import '@fontsource/vt323';
import '@fontsource/share-tech-mono';
import './tutorials.css';
import '../ui/cursors.css';   // the app's cursor set (green in both themes)
import '../about/modern-pages.css';
import { attachModernGlow } from '../about/modernGlow';
attachModernGlow();

interface Chapter { t: number; text: string }
interface Lesson {
  id: string; number: number; title: string; blurb: string;
  duration: number | null; chapters: Chapter[];
  /** 'w / h' for a lesson recorded at its own shape (the portrait phone lesson). */
  aspect?: string;
}
interface Track { level?: string; title: string; lessons: Lesson[] }
interface Manifest { tracks: Track[] }

const BASE = './tutorials/';
const WATCHED_KEY = 'rw-tutorials-watched';
const AUTOPLAY_KEY = 'rw-tutorials-autoplay';

// localStorage can throw (private mode, blocked storage) — viewer
// conveniences only, so failures just mean nothing is remembered.
function loadSet(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]); } catch { return new Set(); }
}
function save(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const video = $<HTMLVideoElement>('tut-video');
const missing = $('tut-missing');
const outline = $('tut-outline');
const chaptersEl = $('tut-chapters');
const prevBtn = $<HTMLButtonElement>('tut-prev');
const nextBtn = $<HTMLButtonElement>('tut-next');
const autoBox = $<HTMLInputElement>('tut-autoplay-box');

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** First sentence of a narration line, for the chapter list. */
const short = (text: string) => (text.match(/^.*?[.!?](\s|$)/)?.[0] ?? text).trim();

async function boot(): Promise<void> {
  let manifest: Manifest;
  try {
    const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    manifest = await res.json() as Manifest;
  } catch {
    $('tut-main').innerHTML = '<p class="tut-error">The tutorial list could not be loaded. Try reloading the page.</p>';
    return;
  }

  const lessons = manifest.tracks.flatMap((t) => t.lessons.map((l) => ({ ...l, track: t.title, level: t.level ?? '' })));
  const watched = loadSet(WATCHED_KEY);
  try { autoBox.checked = localStorage.getItem(AUTOPLAY_KEY) === '1'; } catch { /* ignore */ }
  autoBox.addEventListener('change', () => save(AUTOPLAY_KEY, autoBox.checked ? '1' : '0'));

  // ---- outline
  const links = new Map<string, HTMLAnchorElement>();
  let level: string | undefined;
  for (const t of manifest.tracks) {
    if (t.level && t.level !== level) {
      level = t.level;
      const lv = document.createElement('div');
      lv.className = 'tut-level';
      lv.textContent = level;
      outline.appendChild(lv);
    }
    const h = document.createElement('div');
    h.className = 'tut-track';
    h.textContent = t.title;
    outline.appendChild(h);
    for (const l of t.lessons) {
      const a = document.createElement('a');
      a.href = `#${l.id}`;
      a.className = 'tut-item';
      a.innerHTML = `<span class="tut-num">${l.number}</span><span class="tut-name"></span>`
        + `<span class="tut-dur">${l.duration ? fmt(l.duration) : 'soon'}</span>`;
      (a.querySelector('.tut-name') as HTMLElement).textContent = l.title;
      if (watched.has(l.id)) a.classList.add('watched');
      outline.appendChild(a);
      links.set(l.id, a);
    }
  }

  // ---- player
  let current = 0;
  let chapterItems: HTMLLIElement[] = [];

  function show(index: number, autoplay = false): void {
    current = Math.max(0, Math.min(lessons.length - 1, index));
    const l = lessons[current];
    links.forEach((a, id) => a.classList.toggle('active', id === l.id));
    links.get(l.id)?.scrollIntoView({ block: 'nearest' });
    $('tut-kicker').textContent = [`LESSON ${l.number}`, l.level, l.track].filter(Boolean).join(' · ').toUpperCase();
    $('tut-lesson-title').textContent = l.title;
    $('tut-blurb').textContent = l.blurb;
    document.title = `${l.title} — Rutt/Etra Video Tutorials`;
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === lessons.length - 1;

    const stage = $('tut-stage');
    if (l.aspect) { stage.dataset.aspect = '1'; stage.style.setProperty('--tut-aspect', l.aspect); }
    else { delete stage.dataset.aspect; stage.style.removeProperty('--tut-aspect'); }
    missing.hidden = true;
    video.hidden = false;
    video.innerHTML = '';
    video.poster = `${BASE}${l.id}.jpg`;
    const src = document.createElement('source');
    src.src = `${BASE}${l.id}.mp4`;
    src.type = 'video/mp4';
    src.addEventListener('error', () => { video.hidden = true; missing.hidden = false; });
    const track = document.createElement('track');
    track.kind = 'captions';
    track.src = `${BASE}${l.id}.vtt`;
    track.srclang = 'en';
    track.label = 'English';
    track.default = true;
    video.append(src, track);
    video.load();
    if (autoplay) void video.play().catch(() => { /* autoplay blocked: the viewer presses play */ });

    chaptersEl.innerHTML = '';
    chapterItems = l.chapters.map((c) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span class="tut-t">${fmt(c.t)}</span> `;
      b.append(short(c.text));
      b.addEventListener('click', () => { video.currentTime = c.t; void video.play().catch(() => {}); });
      li.appendChild(b);
      chaptersEl.appendChild(li);
      return li;
    });
  }

  video.addEventListener('timeupdate', () => {
    const l = lessons[current];
    let at = -1;
    l.chapters.forEach((c, i) => { if (video.currentTime >= c.t - 0.05) at = i; });
    chapterItems.forEach((li, i) => li.classList.toggle('current', i === at));
  });
  video.addEventListener('ended', () => {
    const l = lessons[current];
    watched.add(l.id);
    save(WATCHED_KEY, JSON.stringify([...watched]));
    links.get(l.id)?.classList.add('watched');
    if (autoBox.checked && current < lessons.length - 1) location.hash = lessons[current + 1].id;
  });

  prevBtn.addEventListener('click', () => { location.hash = lessons[current - 1].id; });
  nextBtn.addEventListener('click', () => { location.hash = lessons[current + 1].id; });

  const fromHash = (autoplay: boolean) => {
    const id = decodeURIComponent(location.hash.slice(1));
    const i = lessons.findIndex((l) => l.id === id);
    show(i >= 0 ? i : 0, autoplay);
  };
  window.addEventListener('hashchange', () => fromHash(true));
  fromHash(false);
}

void boot();
