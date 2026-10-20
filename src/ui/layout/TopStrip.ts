/**
 * Compact-mode top strip: the wordmark (tap to open Presets), record toggle,
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
    // Just the wordmark (owner: no "Pick a look" / look name beside it — the looks
    // carousel above the shutter already shows which look is on).
    presetBtn.append(presetIcon);
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
