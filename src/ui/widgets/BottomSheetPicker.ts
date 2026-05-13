/**
 * Bottom-sheet replacement for native `<select>` on compact (touch) mode.
 * Native iOS dropdowns render outside the page chrome and break the CRT
 * aesthetic; this picker keeps everything in-app.
 *
 * Usage: pass a list of `{ value, label }` options + currently selected
 * value; receive a callback when the user picks one.
 */

import { BottomSheet } from '../layout/BottomSheet';

export interface SheetPickerOption { value: string; label: string; }

export function presentSheetPicker(opts: {
  title: string;
  options: SheetPickerOption[];
  selected: string;
  onPick: (value: string) => void;
}): void {
  const list = document.createElement('div');
  list.className = 'rw-sheet-picker';
  let sheet: BottomSheet | null = null;
  for (const o of opts.options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rw-sheet-picker-row';
    if (o.value === opts.selected) btn.classList.add('selected');
    btn.textContent = o.label;
    btn.addEventListener('click', () => {
      opts.onPick(o.value);
      sheet?.dismiss();
    });
    list.appendChild(btn);
  }
  sheet = new BottomSheet({ title: opts.title, initialSnap: '60' });
  sheet.open(list);
}
