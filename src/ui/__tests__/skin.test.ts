// @vitest-environment jsdom
/**
 * Skin preference module: localStorage persistence, body[data-skin]
 * stamping (main + registered popout documents), subscribe semantics.
 * The invariant under test: skin state is LOCAL UI state — it never
 * touches Settings, so nothing here imports the store.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

async function freshSkin() {
  vi.resetModules();
  return import('../skin');
}

beforeEach(() => {
  localStorage.clear();
  delete document.body.dataset.skin;
});

describe('skin module', () => {
  it('defaults to RACK with no stored preference (owner decision)', async () => {
    const skin = await freshSkin();
    expect(skin.getSkin()).toBe('rack');
    expect(document.body.dataset.skin).toBe('rack');
  });

  it('reads a stored hardware preference at import and stamps the body', async () => {
    localStorage.setItem('rw-ui-skin', 'hardware');
    const skin = await freshSkin();
    expect(skin.getSkin()).toBe('hardware');
    expect(document.body.dataset.skin).toBe('hardware');
  });

  it('normalizes garbage stored values to the rack default', async () => {
    localStorage.setItem('rw-ui-skin', 'chrome-1998');
    const skin = await freshSkin();
    expect(skin.getSkin()).toBe('rack');
  });

  it('setSkin persists, stamps, and notifies; standard removes the attribute', async () => {
    localStorage.setItem('rw-ui-skin', 'standard');
    const skin = await freshSkin();
    const seen: string[] = [];
    skin.subscribeSkin((s) => seen.push(s));
    expect(seen).toEqual(['standard']); // fires immediately

    skin.setSkin('hardware');
    expect(localStorage.getItem('rw-ui-skin')).toBe('hardware');
    expect(document.body.dataset.skin).toBe('hardware');
    expect(seen).toEqual(['standard', 'hardware']);

    skin.setSkin('standard');
    expect(document.body.dataset.skin).toBeUndefined();
    expect(seen).toEqual(['standard', 'hardware', 'standard']);
  });

  it('setSkin to the current value is a no-op (no duplicate notify)', async () => {
    localStorage.setItem('rw-ui-skin', 'standard');
    const skin = await freshSkin();
    const seen: string[] = [];
    skin.subscribeSkin((s) => seen.push(s));
    skin.setSkin('standard');
    expect(seen).toEqual(['standard']);
  });

  it('toggleSkin cycles standard → hardware → rack → standard', async () => {
    localStorage.setItem('rw-ui-skin', 'standard');
    const skin = await freshSkin();
    expect(skin.toggleSkin()).toBe('hardware');
    expect(skin.toggleSkin()).toBe('rack');
    expect(skin.toggleSkin()).toBe('standard');
  });

  it('reads a stored rack preference at import', async () => {
    localStorage.setItem('rw-ui-skin', 'rack');
    const skin = await freshSkin();
    expect(skin.getSkin()).toBe('rack');
    expect(document.body.dataset.skin).toBe('rack');
  });

  it('unsubscribe stops notifications', async () => {
    localStorage.setItem('rw-ui-skin', 'standard');
    const skin = await freshSkin();
    const seen: string[] = [];
    const off = skin.subscribeSkin((s) => seen.push(s));
    off();
    skin.setSkin('hardware');
    expect(seen).toEqual(['standard']);
  });

  it('stamps registered popout documents and stops after release', async () => {
    localStorage.setItem('rw-ui-skin', 'standard');
    const skin = await freshSkin();
    const popoutDoc = document.implementation.createHTMLDocument('popout');
    skin.applySkinToDocument(popoutDoc);
    expect(popoutDoc.body.dataset.skin).toBeUndefined(); // standard = no attr

    skin.setSkin('hardware');
    expect(popoutDoc.body.dataset.skin).toBe('hardware');

    skin.releaseDocument(popoutDoc);
    skin.setSkin('standard');
    // Released: keeps its last stamp, no longer tracked.
    expect(popoutDoc.body.dataset.skin).toBe('hardware');
    expect(document.body.dataset.skin).toBeUndefined();
  });
});
