/**
 * Project section — the synth's "save your work" UI.
 *
 * Layout (top of the synth tab so it's the first thing users see):
 *   - Status strip: "Project: {name} *" with the asterisk surfacing
 *     unsaved changes. Reads from `ProjectStore.subscribe`.
 *   - Primary actions row: New, Open, Save, Save As.
 *   - Save preset from current project: exports just the visual
 *     preset portion as a `.preset.json`.
 *   - Recent Projects: collapsible list (up to 8). Browsers with the
 *     File System Access API get one-click reopen on entries written
 *     during the same session; on Firefox / Safari the list shows
 *     names only and clicking opens the file picker (best we can do
 *     without persistent file handles).
 *   - Auto-save: toggle + last-snapshot timestamp readout.
 *
 * All file ops route through `ProjectStore`, which itself uses the
 * FS Access API when available and falls back to download/upload
 * otherwise. `confirm()` is used for unsaved-changes prompts —
 * standard file-app idiom; wins on space and matches browser
 * print/save-page UX.
 */

import { ProjectStore, ProjectState, confirmDiscardIfDirty } from '../../project/ProjectStore';
import { AutoSave } from '../../project/AutoSave';
import { describeSummary, presetFromProject } from '../../project/Project';
import { group, button, textInput, readout } from '../widgets';

export interface ProjectSectionDeps {
  projectStore: ProjectStore;
  autoSave: AutoSave;
  /** Show a non-blocking message to the user. main.ts hooks this
   *  to a small toast — the section itself doesn't own toasts. */
  toast: (message: string) => void;
}

export function createProjectSection(deps: ProjectSectionDeps): HTMLElement {
  const { projectStore, autoSave, toast } = deps;
  const root = document.createElement('div');

  // ----------------------------------------------------------------
  // Status strip — project name + dirty indicator.
  // ----------------------------------------------------------------
  const status = group('Project');
  root.appendChild(status.root);

  const statusLine = document.createElement('div');
  statusLine.className = 'rw-readout';
  statusLine.style.fontSize = '13px';
  statusLine.style.padding = '4px 0 8px';
  status.body.appendChild(statusLine);

  const blurb = document.createElement('div');
  blurb.className = 'rw-hint';
  blurb.innerHTML =
    'Saves your <b>complete workspace</b> — preset, timelines, MIDI / OSC / CV bindings, ' +
    'sonification config, panel layout, camera, resolution. Use Presets or Timelines to ' +
    'share just a look or just a score.';
  status.body.appendChild(blurb);

  // ----------------------------------------------------------------
  // Primary actions: New / Open / Save / Save As
  // ----------------------------------------------------------------
  const actions = document.createElement('div');
  actions.className = 'rw-btn-row';

  const newBtn = button('New', async () => {
    const s = projectStore.getState();
    if (!confirmDiscardIfDirty(s)) return;
    projectStore.newProject();
    AutoSave.clearPending();
    toast('Started a new project.');
  });

  const openBtn = button('Open…', async () => {
    const s = projectStore.getState();
    if (!confirmDiscardIfDirty(s)) return;
    if (s.hasFsAccess) {
      try {
        const summary = await projectStore.openWithPicker();
        if (summary) toast(describeSummary(summary));
      } catch (err) {
        toast(`Open failed: ${(err as Error).message}`);
      }
    } else {
      // Firefox / Safari path — trigger a hidden file input.
      pickFile().then(async (file) => {
        if (!file) return;
        try {
          const summary = await projectStore.openFromFile(file);
          if (summary) toast(describeSummary(summary));
        } catch (err) {
          toast(`Open failed: ${(err as Error).message}`);
        }
      });
    }
  });

  const saveBtn = button('Save', async () => {
    const s = projectStore.getState();
    if (!s.name) {
      // No name yet — fall through to Save As.
      await runSaveAs();
      return;
    }
    const ok = await projectStore.saveToCurrent();
    if (ok) {
      AutoSave.clearPending();
      toast(`Saved "${s.name}".`);
    } else {
      toast('Save was cancelled.');
    }
  }, 'primary');

  const saveAsBtn = button('Save As…', () => { void runSaveAs(); });

  async function runSaveAs(): Promise<void> {
    const cur = projectStore.getState();
    const suggested = cur.name ?? `Project ${new Date().toLocaleDateString()}`;
    const name = window.prompt('Project name:', suggested);
    if (name == null) return;
    const ok = await projectStore.saveAs(name);
    if (ok) {
      AutoSave.clearPending();
      toast(`Saved "${name}".`);
    } else {
      toast('Save was cancelled.');
    }
  }

  actions.append(newBtn, openBtn, saveBtn, saveAsBtn);
  status.body.appendChild(actions);

  // Save just the preset (no bindings / hardware setup).
  const sharePresetBtn = button('Save preset from project (.preset.json)', () => {
    const cur = projectStore.getState();
    const name = cur.name ?? 'Untitled';
    const project = projectStore.snapshot(name);
    const preset = presetFromProject(project);
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(name)}.preset.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast(`Exported preset from "${name}".`);
  });
  const shareRow = document.createElement('div');
  shareRow.className = 'rw-btn-row';
  shareRow.appendChild(sharePresetBtn);
  status.body.appendChild(shareRow);

  // ----------------------------------------------------------------
  // Recent Projects
  // ----------------------------------------------------------------
  const recent = group('Recent Projects');
  root.appendChild(recent.root);

  const recentList = document.createElement('div');
  recentList.style.display = 'flex';
  recentList.style.flexDirection = 'column';
  recentList.style.gap = '4px';
  recent.body.appendChild(recentList);

  const recentEmpty = document.createElement('div');
  recentEmpty.className = 'rw-hint';
  recentEmpty.textContent = '— no recent projects —';
  recent.body.appendChild(recentEmpty);

  const clearRecentBtn = button('Clear recent', () => {
    if (!confirm('Clear the Recent Projects list?')) return;
    projectStore.clearRecent();
  }, 'danger');
  recent.body.appendChild(clearRecentBtn);

  // ----------------------------------------------------------------
  // Auto-save
  // ----------------------------------------------------------------
  const auto = group('Auto-save');
  root.appendChild(auto.root);

  const autoBlurb = document.createElement('div');
  autoBlurb.className = 'rw-hint';
  autoBlurb.textContent =
    'Writes the current project to browser storage every 60 seconds when there are unsaved ' +
    'changes. Recovery prompt appears on next page load if the tab crashes. ' +
    'Recovery is a safety net — explicit Save to file is still how you preserve work permanently.';
  auto.body.appendChild(autoBlurb);

  const autoToggleWrap = document.createElement('label');
  autoToggleWrap.className = 'rw-toggle';
  const autoToggleInput = document.createElement('input');
  autoToggleInput.type = 'checkbox';
  const autoToggleSw = document.createElement('span');
  autoToggleSw.className = 'rw-toggle-sw';
  const autoToggleTxt = document.createElement('span');
  autoToggleTxt.className = 'rw-toggle-txt';
  autoToggleTxt.textContent = 'Auto-save every 60 s';
  autoToggleWrap.append(autoToggleInput, autoToggleSw, autoToggleTxt);
  autoToggleInput.checked = autoSave.isEnabled();
  autoToggleInput.addEventListener('change', () => {
    if (autoToggleInput.checked) autoSave.start();
    else autoSave.stop();
    refreshAuto();
  });
  auto.body.appendChild(autoToggleWrap);

  const autoStatus = readout();
  auto.body.appendChild(autoStatus);

  function refreshAuto(): void {
    autoToggleInput.checked = autoSave.isEnabled();
    const pending = AutoSave.loadPending();
    if (pending) {
      autoStatus.textContent =
        `Pending recovery snapshot for "${pending.projectName}" (${AutoSave.formatAge(pending.writtenAt)}).`;
    } else if (autoSave.isEnabled()) {
      autoStatus.textContent = 'Auto-save running. No pending snapshot.';
    } else {
      autoStatus.textContent = 'Auto-save disabled.';
    }
  }
  refreshAuto();
  // Poll occasionally so the "X minutes ago" text stays fresh.
  const refreshTimer = setInterval(refreshAuto, 30_000);
  // Best-effort cleanup if the section is removed; without a
  // MutationObserver the timer just keeps running on detach, but
  // a 30s no-op is harmless. Detach handler is here for symmetry
  // with future lifecycle work.
  void refreshTimer;

  // ----------------------------------------------------------------
  // Subscribe to store state for status strip + recent list.
  // ----------------------------------------------------------------
  projectStore.subscribe((state) => {
    renderStatus(state);
    renderRecent(state);
  });

  function renderStatus(s: ProjectState): void {
    const name = s.name ?? 'Untitled (unsaved)';
    const dirty = s.dirty ? ' *' : '';
    statusLine.innerHTML = `<b>${escapeHtml(name)}</b><span style="color:var(--re-text-dim,#888);">${dirty}</span>`;
  }

  function renderRecent(s: ProjectState): void {
    recentList.innerHTML = '';
    if (s.recent.length === 0) {
      recentEmpty.style.display = '';
      return;
    }
    recentEmpty.style.display = 'none';
    for (const entry of s.recent) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.padding = '4px 0';

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'rw-btn';
      main.style.flex = '1';
      main.style.textAlign = 'left';
      main.textContent = entry.name;
      main.title = `Saved ${entry.savedAt}\nLast opened ${entry.lastOpenedAt}`;
      main.addEventListener('click', async () => {
        if (!confirmDiscardIfDirty(projectStore.getState())) return;
        if (entry.handle) {
          const summary = await projectStore.openRecent(entry);
          if (summary) toast(describeSummary(summary));
          else toast(`Couldn't reopen "${entry.name}" — re-pick the file.`);
        } else {
          // No handle (Firefox/Safari, or persisted across sessions).
          // Trigger the file picker as a fallback.
          const file = await pickFile();
          if (!file) return;
          const summary = await projectStore.openFromFile(file);
          if (summary) toast(describeSummary(summary));
        }
      });
      row.appendChild(main);

      if (!entry.handle) {
        const hint = document.createElement('span');
        hint.className = 'rw-hint';
        hint.textContent = '(re-pick file)';
        hint.style.fontSize = '11px';
        row.appendChild(hint);
      }

      const dropBtn = document.createElement('button');
      dropBtn.type = 'button';
      dropBtn.className = 'rw-btn';
      dropBtn.textContent = '×';
      dropBtn.title = 'Remove from recent list';
      dropBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        projectStore.dropRecent(entry);
      });
      row.appendChild(dropBtn);

      recentList.appendChild(row);
    }
  }

  return root;
}

// --------------------------------------------------------------------
// Local helpers
// --------------------------------------------------------------------

/** Unused for now but exported via a re-export pattern; kept here as
 *  a placeholder for the future "auto-save status" sub-row. */
void textInput;

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.synth.json,application/json';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      const f = inp.files?.[0] ?? null;
      document.body.removeChild(inp);
      resolve(f);
    });
    inp.addEventListener('cancel', () => {
      document.body.removeChild(inp);
      resolve(null);
    });
    inp.click();
  });
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-_]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c] as string));
}
