/**
 * Share section — P2P WebRTC broadcast (PeerJS) and WHIP output streaming.
 *
 * P2P broadcast: the synth becomes a PeerJS peer; viewers open a share URL
 * in any browser and the synth streams directly to them.
 *
 * WHIP output: the synth sends the canvas as a WebRTC stream to a WHIP
 * server (OBS, MediaMTX, Cloudflare Stream, LiveKit, etc.), which
 * re-distributes as HLS, RTMP, or further WebRTC.
 */

import QRCode from 'qrcode';
import { Broadcaster } from '../../stream/Broadcaster';
import { WhipPublisher } from '../../stream/WhipPublisher';
import { row, group, button, readout } from '../widgets';
import { SettingsStore } from '../../state/Settings';

export function createShareSection(settings: SettingsStore, broadcaster: Broadcaster, whip: WhipPublisher, canvas: HTMLCanvasElement): HTMLElement {
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

  // ---- WHIP Output ----
  root.appendChild(buildWhipGroup(settings, whip, canvas));

  return root;
}

function buildWhipGroup(settings: SettingsStore, whip: WhipPublisher, canvas: HTMLCanvasElement): HTMLElement {
  const g = group('WHIP Output');

  // Endpoint URL input
  const endpointInp = document.createElement('input');
  endpointInp.type = 'url';
  endpointInp.className = 'rw-text';
  endpointInp.placeholder = 'http://localhost:8889/whip/stream';
  endpointInp.value = settings.get('whipEndpoint');
  endpointInp.style.width = '100%';
  endpointInp.addEventListener('change', () => settings.set('whipEndpoint', endpointInp.value));

  // Bearer token input (password-masked)
  const tokenInp = document.createElement('input');
  tokenInp.type = 'password';
  tokenInp.className = 'rw-text';
  tokenInp.placeholder = 'leave empty for local / open servers';
  tokenInp.value = settings.get('whipBearerToken');
  tokenInp.style.width = '100%';
  tokenInp.addEventListener('change', () => settings.set('whipBearerToken', tokenInp.value));

  const startWhip = button('Start WHIP', async () => {
    const endpoint = endpointInp.value.trim();
    if (!endpoint) { whipStatus.textContent = 'Enter an endpoint URL first.'; return; }
    try {
      await whip.start({
        canvas,
        fps: settings.get('recordFps'),
        endpoint,
        bearerToken: tokenInp.value.trim() || undefined,
      });
    } catch (err) {
      whipStatus.textContent = `Error: ${(err as Error).message}`;
    }
  }, 'primary');

  const stopWhip = button('Stop', () => whip.stop(), 'danger');
  stopWhip.setAttribute('disabled', 'true');

  const whipBtnRow = document.createElement('div');
  whipBtnRow.className = 'rw-btn-row';
  whipBtnRow.append(startWhip, stopWhip);

  const whipStatus = readout();
  whipStatus.style.marginTop = '8px';
  whipStatus.textContent = 'idle';

  whip.subscribe((s, info) => {
    if (s === 'live') {
      startWhip.setAttribute('disabled', 'true');
      stopWhip.removeAttribute('disabled');
      whipStatus.textContent = 'live — streaming to WHIP server';
    } else if (s === 'connecting') {
      startWhip.setAttribute('disabled', 'true');
      stopWhip.setAttribute('disabled', 'true');
      whipStatus.textContent = 'connecting…';
    } else if (s === 'error') {
      startWhip.removeAttribute('disabled');
      stopWhip.setAttribute('disabled', 'true');
      whipStatus.textContent = `error: ${info.error ?? 'unknown'}`;
    } else {
      startWhip.removeAttribute('disabled');
      stopWhip.setAttribute('disabled', 'true');
      whipStatus.textContent = 'idle';
    }
  });

  const whipNote = document.createElement('div');
  whipNote.className = 'rw-hint';
  whipNote.style.padding = '6px 0';
  whipNote.innerHTML =
    'WHIP streams to OBS, MediaMTX, Cloudflare Stream, LiveKit, etc. ' +
    'The server receives the canvas as WebRTC and re-distributes as HLS, RTMP, or WebRTC. ' +
    'See the Help tab → Stream URL for relay setup instructions.';

  g.body.append(
    row('Endpoint', endpointInp),
    row('Token', tokenInp),
    whipBtnRow,
    whipStatus,
    whipNote,
  );
  return g.root;
}
