/**
 * Presets section — load built-ins, save the current state to a named
 * user preset (in localStorage), or export/import as JSON files.
 */

import { Settings, SettingsStore, migrateSettings } from '../../state/Settings';
import { PRESETS } from '../presets';
import { row, group, button, textInput, readout } from '../widgets';

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

  builtins.body.append(row('Preset', builtinSel), desc, loadBtn);
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

  return root;
}
