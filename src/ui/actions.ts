/**
 * App-wide action registry — the single source of truth for every
 * command the app exposes through MORE than one surface (menu bar,
 * keyboard shortcut, panel button). One id, one implementation; the
 * menu bar renders labels/shortcuts/enabled/checked from here and the
 * keydown listeners in main.ts are thin `runAction(id)` dispatchers.
 * (One concept, one source — previously Ctrl+S, the Project section's
 * SAVE button, and any future menu item would each have carried their
 * own copy of the save-with-prompt dance.)
 *
 * Deliberately tiny and DOM-free so it unit-tests in node.
 */

export interface AppAction {
  /** Namespaced id: 'file.save', 'view.fullscreen', 'help.about', ... */
  id: string;
  label: string;
  /** Display-only shortcut hint, e.g. 'Ctrl+S'. Binding happens in main.ts. */
  shortcut?: string;
  run(): void | Promise<void>;
  /** Absent = always enabled. Polled when a menu opens and before run(). */
  enabled?(): boolean;
  /** For checkbox/radio menu items (HUD, skin, dock side). */
  checked?(): boolean;
}

const actions = new Map<string, AppAction>();

export function registerAction(a: AppAction): void {
  actions.set(a.id, a);
}

export function registerActions(list: AppAction[]): void {
  for (const a of list) registerAction(a);
}

export function getAction(id: string): AppAction | undefined {
  return actions.get(id);
}

/** Run an action if it exists and is enabled. Returns whether it ran. */
export function runAction(id: string): boolean {
  const a = actions.get(id);
  if (!a || (a.enabled && !a.enabled())) return false;
  void a.run();
  return true;
}

/** Test/debug helper. */
export function clearActions(): void {
  actions.clear();
}
