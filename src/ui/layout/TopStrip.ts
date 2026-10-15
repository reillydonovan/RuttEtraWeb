/**
 * Compact-mode top strip: preset name (tap to open Presets), record toggle,
 * broadcast toggle, help button. ~48px tall, respects safe-area-inset-top.
 */

export interface TopStripActions {
  onOpenPresets: () => void;
  onToggleRecord: () => void;
  onToggleBroadcast: () => void;
  onOpenHelp: () => void;
}

export class TopStrip {
  el: HTMLElement;
  private presetLabel: HTMLSpanElement;
  private recordBtn: HTMLButtonElement;
  private broadcastBtn: HTMLButtonElement;

  constructor(actions: TopStripActions) {
    this.el = document.createElement('header');
    this.el.id = 'top-strip';

    const presetBtn = document.createElement('button');
    presetBtn.type = 'button';
    presetBtn.className = 'rw-top-preset';
    presetBtn.setAttribute('aria-label', 'Open presets');
    const presetIcon = document.createElement('span');
    presetIcon.className = 'rw-top-icon';
    presetIcon.textContent = 'RUTT/ETRA WEB';
    this.presetLabel = document.createElement('span');
    this.presetLabel.className = 'rw-top-preset-name';
    this.presetLabel.textContent = 'Pick a look';
    presetBtn.append(presetIcon, this.presetLabel);
    presetBtn.addEventListener('click', () => actions.onOpenPresets());

    const right = document.createElement('div');
    right.className = 'rw-top-actions';

    this.recordBtn = makeBtn('REC', 'Record', () => actions.onToggleRecord());
    this.recordBtn.classList.add('rw-top-rec');
    this.broadcastBtn = makeBtn('BC',  'Broadcast', () => actions.onToggleBroadcast());
    const helpBtn = makeBtn('?', 'Help', () => actions.onOpenHelp());
    helpBtn.classList.add('rw-top-help');

    right.append(this.recordBtn, this.broadcastBtn, helpBtn);

    this.el.append(presetBtn, right);
  }

  setPresetName(name: string): void {
    this.presetLabel.textContent = name;
  }

  setRecording(on: boolean): void {
    this.recordBtn.classList.toggle('on', on);
    this.recordBtn.setAttribute('aria-pressed', String(on));
  }

  setBroadcasting(on: boolean): void {
    this.broadcastBtn.classList.toggle('on', on);
    this.broadcastBtn.setAttribute('aria-pressed', String(on));
  }
}

function makeBtn(label: string, ariaLabel: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rw-top-btn';
  b.textContent = label;
  b.setAttribute('aria-label', ariaLabel);
  b.addEventListener('click', onClick);
  return b;
}
