/**
 * Generic "learn" binding table.
 *
 * Both MIDI and OSC sections need the same UI: a table where each row
 * represents a binding (an external source -> a Settings target), with a
 * "Learn" button to capture the next incoming message and bind it.
 *
 * The widget is binding-agnostic: callers supply describe / list / learn /
 * update / remove callbacks. We render the rows and propagate edits.
 */

import { BindingCurve } from '../../state/Settings';
import { button } from '../widgets';

export interface LearnTableHooks<B extends { id: string; target: string; curve: BindingCurve; min: number; max: number }> {
  /** Initial bindings list. The widget re-reads it whenever the parent re-renders. */
  list(): B[];
  /** Plain-English description of where the binding is listening (e.g. 'CC#7 ch1'). */
  describeSource(b: B): string;
  /** Begin a learn capture; resolves with the new binding once a message arrives. */
  learn(target: string): Promise<B>;
  /** Patch an existing binding by id (used when the user edits min/max/curve/target). */
  update(id: string, patch: Partial<B>): void;
  /** Remove a binding by id. */
  remove(id: string): void;
  /** Whether a learn is currently in flight (sets row indicator). */
  isLearning(): boolean;
  /** Cancel an in-flight learn (called when the user clicks Learn on another row). */
  cancelLearn(): void;
  /** Subscribe to bindings list updates so the table re-renders on change. */
  subscribe(fn: (list: B[]) => void): () => void;
  /** Available target keys for the dropdown. */
  targetOptions: { value: string; label: string }[];
}

export function createLearnTable<B extends { id: string; target: string; curve: BindingCurve; min: number; max: number }>(
  hooks: LearnTableHooks<B>,
): HTMLElement {
  const root = document.createElement('div');
  root.className = 'rw-learn';

  const head = document.createElement('div');
  head.className = 'rw-learn-head';
  for (const label of ['SOURCE', 'TARGET', 'CURVE', 'MIN', 'MAX', '']) {
    const cell = document.createElement('div');
    cell.textContent = label;
    head.appendChild(cell);
  }
  root.appendChild(head);

  const body = document.createElement('div');
  body.className = 'rw-learn-body';
  root.appendChild(body);

  const renderRows = (bindings: B[]) => {
    body.innerHTML = '';
    if (bindings.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'rw-learn-empty';
      empty.textContent = 'No bindings yet — click "Learn" then move a control.';
      body.appendChild(empty);
      return;
    }
    for (const b of bindings) body.appendChild(renderRow(b));
  };

  const renderRow = (b: B): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'rw-learn-row';

    const src = document.createElement('div');
    src.className = 'rw-learn-src';
    src.textContent = hooks.describeSource(b);
    row.appendChild(src);

    const tgt = document.createElement('select');
    tgt.className = 'rw-select';
    for (const opt of hooks.targetOptions) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      tgt.appendChild(o);
    }
    tgt.value = b.target || '';
    tgt.addEventListener('change', () => hooks.update(b.id, { target: tgt.value } as Partial<B>));
    row.appendChild(tgt);

    const curve = document.createElement('select');
    curve.className = 'rw-select';
    for (const c of ['linear', 'exp', 'log', 'inverted'] as BindingCurve[]) {
      const o = document.createElement('option');
      o.value = c; o.textContent = c;
      curve.appendChild(o);
    }
    curve.value = b.curve;
    curve.addEventListener('change', () => hooks.update(b.id, { curve: curve.value as BindingCurve } as Partial<B>));
    row.appendChild(curve);

    const min = document.createElement('input');
    min.type = 'number'; min.value = String(b.min); min.step = '0.01';
    min.className = 'rw-num';
    min.addEventListener('input', () => {
      const v = parseFloat(min.value);
      if (!Number.isNaN(v)) hooks.update(b.id, { min: v } as Partial<B>);
    });
    row.appendChild(min);

    const max = document.createElement('input');
    max.type = 'number'; max.value = String(b.max); max.step = '0.01';
    max.className = 'rw-num';
    max.addEventListener('input', () => {
      const v = parseFloat(max.value);
      if (!Number.isNaN(v)) hooks.update(b.id, { max: v } as Partial<B>);
    });
    row.appendChild(max);

    const remove = button('×', () => hooks.remove(b.id), 'danger');
    remove.title = 'Remove binding';
    row.appendChild(remove);

    return row;
  };

  // Add binding control: pick a target, then learn.
  const addRow = document.createElement('div');
  addRow.className = 'rw-learn-add';
  const addTarget = document.createElement('select');
  addTarget.className = 'rw-select';
  for (const opt of [{ value: '', label: 'Select target…' }, ...hooks.targetOptions]) {
    const o = document.createElement('option');
    o.value = opt.value; o.textContent = opt.label;
    addTarget.appendChild(o);
  }
  const learnBtn = button('Learn', async () => {
    const target = addTarget.value;
    if (!target) {
      learnBtn.classList.add('shake');
      window.setTimeout(() => learnBtn.classList.remove('shake'), 400);
      return;
    }
    if (hooks.isLearning()) hooks.cancelLearn();
    learnBtn.classList.add('learning');
    learnBtn.textContent = 'Learning…';
    try {
      await hooks.learn(target);
      addTarget.value = '';
    } catch (err) {
      console.warn('learn failed', err);
    } finally {
      learnBtn.classList.remove('learning');
      learnBtn.textContent = 'Learn';
    }
  }, 'primary');
  addRow.append(addTarget, learnBtn);
  root.appendChild(addRow);

  // Subscribe to changes.
  const initial = hooks.list();
  renderRows(initial);
  hooks.subscribe((list) => renderRows(list));

  return root;
}
