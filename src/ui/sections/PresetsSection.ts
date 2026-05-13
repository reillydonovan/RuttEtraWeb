/**
 * Presets section — load built-ins, save the current state to a named
 * user preset (in localStorage), or export/import as JSON files.
 *
 * Built-in preset chips are also draggable onto the Timeline dock to drop
 * a keyframe with that preset's values (MIME `application/x-ruttetra-preset`).
 */

import { Settings, SettingsStore, migrateSettings } from '../../state/Settings';
import { PRESETS } from '../presets';
import { row, group, button, textInput, readout } from '../widgets';
import { exportEverything, importEverything } from '../../state/exportEverything';

const PRESET_MIME = 'application/x-ruttetra-preset';

const USER_KEY = 'ruttetra.userPresets.v1';

interface UserPreset { id: string; name: string; values: Partial<Settings>; }

function loadUser(): UserPreset[] {
  try {
    const s = localStorage.getItem(USER_KEY);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
}
function saveUser(list: UserPreset[]): void {
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
    });
    chips.appendChild(c);
  }

  builtins.body.append(chips, row('Preset', builtinSel), desc, loadBtn);
  root.appendChild(builtins.root);

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
    const blob = new Blob([settings.export()], { type: 'application/json' });
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

  const resetBtn = button('Reset All to Defaults', () => {
    if (confirm('Reset every setting to defaults?')) settings.reset();
  }, 'danger');
  root.appendChild(resetBtn);

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

  return root;
}
