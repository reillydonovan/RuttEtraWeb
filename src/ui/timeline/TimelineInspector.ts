/**
 * Selected-keyframe editor: bar position / easing / name / lock / preview.
 */

import { Sequencer } from '../../sequencer/Sequencer';
import { EasingType } from '../../sequencer/types';

const EASINGS: EasingType[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'step', 'hold'];

export class TimelineInspector {
  el: HTMLElement;
  private seq: Sequencer;

  constructor(seq: Sequencer) {
    this.seq = seq;
    this.el = document.createElement('div');
    this.el.className = 'rw-tl-inspector';
    this.render();
  }

  render(): void {
    const t = this.seq.timeline;
    const id = this.seq.selectedKeyframeId;
    const kf = t && id ? t.keyframes.find(k => k.id === id) : null;
    this.el.innerHTML = '';

    const h = document.createElement('h4');
    h.textContent = 'KEYFRAME';
    this.el.appendChild(h);

    if (!kf) {
      const e = document.createElement('div');
      e.className = 'rw-empty';
      e.textContent = 'select a keyframe';
      this.el.appendChild(e);
      return;
    }

    // Name
    this.el.appendChild(this.row('Name', this.text(kf.presetName ?? '', (v) => {
      this.seq.updateKeyframe(kf.id, { presetName: v || undefined });
    })));

    // Bar
    this.el.appendChild(this.row('Bar', this.numInput(kf.bar, 0, t!.lengthBars, 0.01, (v) => {
      this.seq.moveKeyframe(kf.id, v);
    })));

    // Easing
    {
      const sel = document.createElement('select');
      sel.className = 'rw-select';
      for (const e of EASINGS) {
        const o = document.createElement('option');
        o.value = e; o.textContent = e;
        if (kf.easing === e) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => this.seq.updateKeyframe(kf.id, { easing: sel.value as EasingType }));
      this.el.appendChild(this.row('Easing', sel));
    }

    // Color
    {
      const c = document.createElement('input');
      c.type = 'color';
      c.value = kf.color ?? '#5fff85';
      c.addEventListener('change', () => this.seq.updateKeyframe(kf.id, { color: c.value }));
      this.el.appendChild(this.row('Color', c));
    }

    // Lock
    {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!kf.locked;
      cb.addEventListener('change', () => this.seq.updateKeyframe(kf.id, { locked: cb.checked }));
      this.el.appendChild(this.row('Lock', cb));
    }

    // Buttons row
    const actions = document.createElement('div');
    actions.style.display = 'flex'; actions.style.gap = '4px'; actions.style.marginTop = '6px';
    actions.appendChild(this.button('PREVIEW', () => this.seq.preview(kf.id)));
    actions.appendChild(this.button('REPLACE', () => this.seq.replaceSnapshot(kf.id), 'Capture current settings'));
    actions.appendChild(this.button('DUP',     () => this.seq.duplicateKeyframe(kf.id)));
    actions.appendChild(this.button('DEL',     () => this.seq.removeKeyframe(kf.id), undefined, 'warn'));
    this.el.appendChild(actions);
  }

  // -- helpers --
  private row(label: string, control: HTMLElement): HTMLElement {
    const r = document.createElement('div');
    r.className = 'rw-row';
    const l = document.createElement('label');
    l.textContent = label;
    r.append(l, control);
    return r;
  }

  private text(value: string, onChange: (v: string) => void): HTMLInputElement {
    const i = document.createElement('input');
    i.type = 'text'; i.className = 'rw-text'; i.value = value;
    i.addEventListener('change', () => onChange(i.value));
    return i;
  }

  private numInput(value: number, min: number, max: number, step: number, onChange: (v: number) => void): HTMLInputElement {
    const i = document.createElement('input');
    i.type = 'number'; i.className = 'rw-num';
    i.min = String(min); i.max = String(max); i.step = String(step);
    i.value = String(value);
    i.addEventListener('change', () => {
      const v = parseFloat(i.value);
      if (Number.isFinite(v)) onChange(v);
    });
    return i;
  }

  private button(label: string, onClick: () => void, title?: string, kind?: 'warn'): HTMLElement {
    const b = document.createElement('button');
    b.className = 'rw-btn'; b.type = 'button'; b.textContent = label;
    if (title) b.title = title;
    if (kind) b.classList.add(kind);
    b.addEventListener('click', onClick);
    return b;
  }
}
