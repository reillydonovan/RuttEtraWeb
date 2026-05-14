/**
 * Presets section — load built-ins, save the current state to a named
 * user preset (in-memory by default), or export/import as JSON files.
 *
 * Built-in preset chips are also draggable onto the Timeline dock to drop
 * a keyframe with that preset's values (MIME `application/x-ruttetra-preset`).
 *
 * Persistence: user presets are NOT auto-saved between sessions to match
 * the GUI-wide "fresh start on refresh" policy. Explicit save / load /
 * export / import are still available via the buttons in this section.
 */

import { Settings, SettingsStore, migrateSettings } from '../../state/Settings';
import { PRESETS } from '../presets';
import { row, group, button, textInput, readout } from '../widgets';
import { exportEverything, importEverything } from '../../state/exportEverything';
import { haptic } from '../../platform/HapticFeedback';
import { isFactoryView } from '../../renderer/CameraRig';

const PRESET_MIME = 'application/x-ruttetra-preset';

const USER_KEY = 'ruttetra.userPresets.v1';

/**
 * In-session-only user preset store. Auto-persistence is off so every
 * refresh starts empty; flip this on (and the matching flags in
 * `Settings.ts` and `sequencer/store.ts`) to restore legacy auto-save.
 */
const PERSIST_USER_PRESETS = false;

interface UserPreset { id: string; name: string; values: Partial<Settings>; }

let inMemoryUserPresets: UserPreset[] = [];

function loadUser(): UserPreset[] {
  if (!PERSIST_USER_PRESETS) return inMemoryUserPresets.slice();
  try {
    const s = localStorage.getItem(USER_KEY);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
}
function saveUser(list: UserPreset[]): void {
  if (!PERSIST_USER_PRESETS) {
    inMemoryUserPresets = list.slice();
    return;
  }
  try { localStorage.setItem(USER_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

export function createPresetsSection(settings: SettingsStore): HTMLElement {
  const root = document.createElement('div');

  const builtins = group('Built-in Presets');
  const builtinSel = document.createElement('select');
  builtinSel.className = 'rw-select';
  for (const p of PRESETS) {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    builtinSel.appendChild(o);
  }
  const desc = readout();
  function refreshBuiltinDesc() {
    const p = PRESETS.find((x) => x.id === builtinSel.value);
    desc.textContent = p?.description ?? '';
  }
  refreshBuiltinDesc();
  builtinSel.addEventListener('change', refreshBuiltinDesc);

  const loadBtn = button('Load', () => {
    const p = PRESETS.find((x) => x.id === builtinSel.value);
    if (p) {
      const migrated = migrateSettings(p.values) as Partial<Settings>;
      delete (migrated as { _v?: number })._v;
      settings.patch(migrated);
      haptic('click');
    }
  }, 'primary');

  // Drag-anywhere chip strip — click to load, drag onto timeline to add kf.
  const chips = document.createElement('div');
  chips.className = 'rw-preset-chips';
  for (const p of PRESETS) {
    const c = document.createElement('div');
    c.className = 'rw-preset-chip';
    c.textContent = p.name;
    c.title = `${p.description}\n(drag onto timeline to add keyframe)`;
    c.draggable = true;
    c.addEventListener('dragstart', (ev) => {
      if (!ev.dataTransfer) return;
      ev.dataTransfer.setData(PRESET_MIME, JSON.stringify(p));
      ev.dataTransfer.setData('text/plain', p.name);
      ev.dataTransfer.effectAllowed = 'copy';
      c.classList.add('dragging');
    });
    c.addEventListener('dragend', () => c.classList.remove('dragging'));
    c.addEventListener('click', () => {
      builtinSel.value = p.id;
      refreshBuiltinDesc();
      const migrated = migrateSettings(p.values) as Partial<Settings>;
      delete (migrated as { _v?: number })._v;
      settings.patch(migrated);
      haptic('click');
    });
    chips.appendChild(c);
  }

  builtins.body.append(chips, row('Preset', builtinSel), desc, loadBtn);
  root.appendChild(builtins.root);

  // ---------------- Quick Save / Load ----------------
  // Single-slot save to localStorage so the user can persist a tweak across
  // refreshes without having to download a JSON file. Auto-persistence is
  // off, so this is the only way settings stick around.
  const SAVED_AT_KEY = 'ruttetra.settings.savedAt';
  const SETTINGS_KEY = 'ruttetra.settings.v1';
  const saveLoad = group('Save / Load Settings');
  const status = readout();
  status.style.color = 'var(--re-text-dim)';
  const saveSettingsBtn = button('Save Settings', () => {
    settings.persist();
    try { localStorage.setItem(SAVED_AT_KEY, new Date().toISOString()); } catch { /* ignore */ }
    refreshSavedStatus();
    haptic('click');
  }, 'primary') as HTMLButtonElement;
  saveSettingsBtn.title = 'Snapshot the current GUI state to local storage.';
  const loadSettingsBtn = button('Load Saved', () => {
    const persisted = SettingsStore.loadPersisted();
    if (!persisted) {
      alert('No saved settings to load.');
      return;
    }
    if (!confirm(
      'Loading will replace every current setting with the saved snapshot. '
      + 'Any unsaved changes will be lost. Continue?',
    )) return;
    settings.replaceAll(persisted);
    haptic('click');
  }) as HTMLButtonElement;
  loadSettingsBtn.title = 'Replace current GUI state with the last saved snapshot.';
  const clearSavedBtn = button('Clear Saved', () => {
    if (!confirm('Delete the saved snapshot from local storage?')) return;
    try {
      localStorage.removeItem(SETTINGS_KEY);
      localStorage.removeItem(SAVED_AT_KEY);
    } catch { /* ignore */ }
    refreshSavedStatus();
  }, 'danger') as HTMLButtonElement;
  clearSavedBtn.title = 'Remove the saved snapshot. Does not change current GUI state.';
  function refreshSavedStatus(): void {
    const ts = (() => { try { return localStorage.getItem(SAVED_AT_KEY); } catch { return null; } })();
    const has = (() => { try { return localStorage.getItem(SETTINGS_KEY) != null; } catch { return false; } })();
    if (has && ts) {
      const d = new Date(ts);
      status.textContent = `Saved: ${d.toLocaleString()}`;
      loadSettingsBtn.disabled = false;
      clearSavedBtn.disabled = false;
    } else if (has) {
      status.textContent = 'Saved (timestamp unknown)';
      loadSettingsBtn.disabled = false;
      clearSavedBtn.disabled = false;
    } else {
      status.textContent = 'No saved settings.';
      loadSettingsBtn.disabled = true;
      clearSavedBtn.disabled = true;
    }
  }
  const slBtns = document.createElement('div');
  slBtns.className = 'rw-btn-row';
  slBtns.append(saveSettingsBtn, loadSettingsBtn, clearSavedBtn);
  saveLoad.body.append(slBtns, status);
  refreshSavedStatus();
  root.appendChild(saveLoad.root);

  // User presets
  const user = group('User Presets');
  const userSel = document.createElement('select');
  userSel.className = 'rw-select';

  function refreshUser() {
    const list = loadUser();
    userSel.innerHTML = '';
    if (list.length === 0) {
      const o = document.createElement('option');
      o.disabled = true; o.textContent = '— none saved —';
      userSel.appendChild(o);
    } else {
      for (const p of list) {
        const o = document.createElement('option');
        o.value = p.id; o.textContent = p.name;
        userSel.appendChild(o);
      }
    }
  }
  refreshUser();

  const nameInp = textInput('', 'preset name');
  const saveBtn = button('Save Current', () => {
    const name = nameInp.value.trim() || `Preset ${Date.now()}`;
    const id = `user-${Date.now()}`;
    const list = loadUser();
    list.push({ id, name, values: { ...settings.all } });
    saveUser(list);
    refreshUser();
    nameInp.value = '';
  });
  const loadUserBtn = button('Load', () => {
    const list = loadUser();
    const p = list.find((x) => x.id === userSel.value);
    if (p) {
      const migrated = migrateSettings(p.values) as Partial<Settings>;
      delete (migrated as { _v?: number })._v;
      settings.patch(migrated);
    }
  }, 'primary');
  const delBtn = button('Delete', () => {
    const list = loadUser().filter((x) => x.id !== userSel.value);
    saveUser(list);
    refreshUser();
  }, 'danger');

  const ubtns = document.createElement('div');
  ubtns.className = 'rw-btn-row';
  ubtns.append(loadUserBtn, saveBtn, delBtn);

  user.body.append(row('Saved', userSel), row('Name', nameInp), ubtns);
  root.appendChild(user.root);

  // Import / Export
  const ioGroup = group('Import / Export');
  const exportBtn = button('Export JSON', () => {
    // Strip `defaultView` when it equals the factory defaults so a preset
    // exported after Hard Reset doesn't carry a bespoke saved camera view.
    // Importers fall back to whatever the receiver's own saved view is.
    const obj = JSON.parse(settings.export()) as Record<string, unknown>;
    if (isFactoryView(obj.defaultView as never)) delete obj.defaultView;
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `ruttetra-preset-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const importInp = document.createElement('input');
  importInp.type = 'file';
  importInp.accept = 'application/json,.json';
  importInp.className = 'rw-text';
  importInp.addEventListener('change', async () => {
    const f = importInp.files?.[0];
    if (!f) return;
    const text = await f.text();
    try { settings.import(text); } catch (e) { alert(`Import failed: ${(e as Error).message}`); }
  });
  ioGroup.body.append(row('Import', importInp), exportBtn);
  root.appendChild(ioGroup.root);

  // Backup & Restore (settings + user presets + timelines).
  const backup = group('Backup & Restore');
  const exportEverythingBtn = button('Export Everything', () => {
    const json = exportEverything();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const a = document.createElement('a');
    a.href = url; a.download = `ruttetra-backup-${ts}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  });
  const importEverythingInp = document.createElement('input');
  importEverythingInp.type = 'file';
  importEverythingInp.accept = 'application/json,.json';
  importEverythingInp.className = 'rw-text';
  importEverythingInp.addEventListener('change', async () => {
    const f = importEverythingInp.files?.[0];
    if (!f) return;
    if (!confirm('Import will overwrite local settings, user presets, and timelines. Continue?')) {
      importEverythingInp.value = '';
      return;
    }
    const text = await f.text();
    try {
      importEverything(text);
      alert('Import complete. Reloading...');
      location.reload();
    } catch (e) {
      alert(`Import failed: ${(e as Error).message}`);
    }
  });
  backup.body.append(exportEverythingBtn, row('Restore', importEverythingInp));
  const warn = readout();
  warn.style.color = 'var(--re-text-dim)';
  warn.textContent = 'Includes settings, user presets, timelines, MIDI/OSC bindings.';
  backup.body.appendChild(warn);
  root.appendChild(backup.root);

  // ---- Danger zone: Hard Reset ----
  // Wipes every parameter back to factory defaults, kills any in-memory user
  // presets / timelines, and erases legacy auto-saved localStorage so a stale
  // snapshot from before persistence was disabled can't haunt future refreshes.
  // Reload guarantees a clean DOM rebuild.
  const danger = group('Danger Zone');
  const hardResetBtn = button('Hard Reset GUI', () => {
    if (!confirm(
      'Hard reset will wipe ALL settings, patches, user presets, and timelines '
      + 'back to factory defaults, then reload the page. This cannot be undone.\n\n'
      + 'Continue?',
    )) return;
    settings.reset();
    inMemoryUserPresets = [];
    refreshUser();
    try {
      localStorage.removeItem('ruttetra.settings.v1');
      localStorage.removeItem('ruttetra.settings.savedAt');
      localStorage.removeItem('ruttetra.userPresets.v1');
      localStorage.removeItem('ruttetra.timelines.v1');
    } catch { /* ignore */ }
    haptic('click');
    location.reload();
  }, 'danger');
  hardResetBtn.title = 'Reset every control + clear all saved data, then reload.';
  const dangerNote = readout();
  dangerNote.style.color = 'var(--re-text-dim)';
  dangerNote.textContent = 'Auto-save is OFF — refresh always starts fresh. Use this to also wipe any leftover saved data from previous sessions.';
  danger.body.append(hardResetBtn, dangerNote);
  root.appendChild(danger.root);

  return root;
}
