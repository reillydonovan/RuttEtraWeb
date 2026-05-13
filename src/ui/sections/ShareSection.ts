/**
 * Share section — start/stop a WebRTC broadcast, display the share URL,
 * a QR code, and a live viewer count.
 */

import QRCode from 'qrcode';
import { Broadcaster } from '../../stream/Broadcaster';
import { row, group, button, readout } from '../widgets';
import { SettingsStore } from '../../state/Settings';

export function createShareSection(settings: SettingsStore, broadcaster: Broadcaster, canvas: HTMLCanvasElement): HTMLElement {
  const root = document.createElement('div');

  const cfg = group('Configuration');
  const fpsRow = document.createElement('div');
  fpsRow.className = 'rw-hint';
  fpsRow.textContent = 'Stream FPS uses the same setting as Record.';
  const includeMicLabel = document.createElement('label');
  includeMicLabel.className = 'rw-toggle';
  const cb = document.createElement('input'); cb.type = 'checkbox';
  const sw = document.createElement('span'); sw.className = 'rw-toggle-sw';
  const tx = document.createElement('span'); tx.className = 'rw-toggle-txt'; tx.textContent = 'include mic';
  includeMicLabel.append(cb, sw, tx);
  cfg.body.append(row('Mic', includeMicLabel), fpsRow);
  root.appendChild(cfg.root);

  const startBtn = button('Start Broadcast', async () => {
    try {
      await broadcaster.start({
        canvas,
        fps: settings.get('recordFps'),
        includeMic: cb.checked,
      });
    } catch (err) {
      status.textContent = `Error: ${(err as Error).message}`;
    }
  }, 'primary');

  const stopBtn = button('Stop', () => broadcaster.stop(), 'danger');
  stopBtn.setAttribute('disabled', 'true');

  const btnRow = document.createElement('div');
  btnRow.className = 'rw-btn-row';
  btnRow.append(startBtn, stopBtn);
  root.appendChild(btnRow);

  const status = readout();
  status.style.marginTop = '8px';
  root.appendChild(status);

  const urlBox = readout();
  urlBox.style.marginTop = '8px';
  urlBox.textContent = 'no broadcast active';
  root.appendChild(urlBox);

  const copyBtn = button('Copy URL', () => {
    const url = broadcaster.shareURL();
    if (url) {
      navigator.clipboard.writeText(url).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => (copyBtn.textContent = 'Copy URL'), 1500);
      }).catch(() => {});
    }
  });
  copyBtn.setAttribute('disabled', 'true');
  root.appendChild(copyBtn);

  const qrWrap = document.createElement('div');
  qrWrap.className = 'rw-qr';
  qrWrap.style.display = 'none';
  const qrCanvas = document.createElement('canvas');
  qrWrap.appendChild(qrCanvas);
  root.appendChild(qrWrap);

  broadcaster.subscribe((s, info) => {
    if (s === 'live') {
      startBtn.setAttribute('disabled', 'true');
      stopBtn.removeAttribute('disabled');
      copyBtn.removeAttribute('disabled');
      const url = broadcaster.shareURL();
      urlBox.textContent = `viewers: ${info.viewers}\n${url}`;
      QRCode.toCanvas(qrCanvas, url, { width: 220, margin: 1 }).then(() => {
        qrWrap.style.display = 'block';
      }).catch(() => { qrWrap.style.display = 'none'; });
      status.textContent = `peer id: ${info.id}`;
    } else if (s === 'connecting') {
      status.textContent = 'connecting to PeerJS broker…';
      startBtn.setAttribute('disabled', 'true');
    } else if (s === 'error') {
      status.textContent = `error: ${info.error ?? 'unknown'}`;
      startBtn.removeAttribute('disabled');
      stopBtn.setAttribute('disabled', 'true');
      copyBtn.setAttribute('disabled', 'true');
    } else {
      startBtn.removeAttribute('disabled');
      stopBtn.setAttribute('disabled', 'true');
      copyBtn.setAttribute('disabled', 'true');
      urlBox.textContent = 'no broadcast active';
      qrWrap.style.display = 'none';
      status.textContent = 'idle';
    }
  });

  const note = document.createElement('div');
  note.className = 'rw-hint';
  note.style.padding = '6px 0';
  note.innerHTML = 'Uses the public PeerJS broker for signaling. Both browsers must be able to reach <code>peerjs.com</code>. NAT-challenged networks may need a TURN server.';
  root.appendChild(note);

  return root;
}
