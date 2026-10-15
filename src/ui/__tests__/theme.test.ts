// @vitest-environment jsdom
/**
 * Theme preference module: localStorage persistence, body/html
 * data-theme stamping (main + registered popout documents), subscribe
 * semantics. Like the skin, theme state is LOCAL UI state — never a
 * Settings key.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function freshTheme() {
  vi.resetModules();
  return import('../theme');
}

beforeEach(() => {
  localStorage.clear();
  delete document.body.dataset.theme;
  delete document.documentElement.dataset.theme;
});

describe('theme module', () => {
  it('defaults to modern (stamped) with nothing stored', async () => {
    const t = await freshTheme();
    expect(t.getTheme()).toBe('modern');
    expect(document.body.dataset.theme).toBe('modern');
  });

  it('respects a stored phosphor (classic) preference', async () => {
    localStorage.setItem('rw-ui-theme', 'phosphor');
    const t = await freshTheme();
    expect(t.getTheme()).toBe('phosphor');
    expect(document.body.dataset.theme).toBeUndefined();
  });

  it('reads a stored modern preference and stamps body + html', async () => {
    localStorage.setItem('rw-ui-theme', 'modern');
    const t = await freshTheme();
    expect(t.getTheme()).toBe('modern');
    expect(document.body.dataset.theme).toBe('modern');
    expect(document.documentElement.dataset.theme).toBe('modern');
  });

  it('normalizes garbage stored values to the default (modern)', async () => {
    localStorage.setItem('rw-ui-theme', 'neon-1999');
    const t = await freshTheme();
    expect(t.getTheme()).toBe('modern');
  });

  it('setTheme persists, stamps, notifies; phosphor removes the attribute', async () => {
    localStorage.setItem('rw-ui-theme', 'phosphor');
    const t = await freshTheme();
    const seen: string[] = [];
    t.subscribeTheme((x) => seen.push(x));
    t.setTheme('modern');
    expect(localStorage.getItem('rw-ui-theme')).toBe('modern');
    expect(document.body.dataset.theme).toBe('modern');
    t.setTheme('phosphor');
    expect(document.body.dataset.theme).toBeUndefined();
    expect(seen).toEqual(['phosphor', 'modern', 'phosphor']);
  });

  it('stamps registered popout documents and stops after release', async () => {
    localStorage.setItem('rw-ui-theme', 'phosphor');
    const t = await freshTheme();
    const popDoc = document.implementation.createHTMLDocument('popout');
    t.applyThemeToDocument(popDoc);
    t.setTheme('modern');
    expect(popDoc.body.dataset.theme).toBe('modern');
    t.releaseThemeDocument(popDoc);
    t.setTheme('phosphor');
    expect(popDoc.body.dataset.theme).toBe('modern');
  });
});
