// Stand-ins for hardware/bridges so the I/O lessons show real, working
// connections on a machine with nothing plugged in.

import { WebSocketServer } from 'ws';

/**
 * Page script: replaces navigator.requestMIDIAccess with one fake input
 * ("Tutorial Controller") and output. The tour drives it with
 * window.__midi.cc(cc, value) / window.__midi.clock(bpm) / .stopClock().
 */
export const FAKE_MIDI_SCRIPT = `(() => {
  const input = new EventTarget();
  Object.assign(input, { id: 'tut-in', name: 'Tutorial Controller', manufacturer: 'RuttEtraWeb', type: 'input',
    state: 'connected', connection: 'open', open: async () => input, close: async () => input });
  const output = { id: 'tut-out', name: 'Tutorial Synth', manufacturer: 'RuttEtraWeb', type: 'output',
    state: 'connected', connection: 'open', send() {}, open: async () => output, close: async () => output,
    addEventListener() {}, removeEventListener() {} };
  const access = { inputs: new Map([[input.id, input]]), outputs: new Map([[output.id, output]]),
    sysexEnabled: false, onstatechange: null, addEventListener() {}, removeEventListener() {} };
  navigator.requestMIDIAccess = async () => access;
  const send = (bytes) => {
    const e = new Event('midimessage');
    Object.defineProperty(e, 'data', { value: new Uint8Array(bytes) });
    input.dispatchEvent(e);
  };
  let timer = null;
  window.__midi = {
    send,
    cc: (cc, v, ch = 0) => send([0xb0 | ch, cc, Math.max(0, Math.min(127, Math.round(v)))]),
    clock(bpm) {
      clearInterval(timer);
      send([0xfa]);
      timer = setInterval(() => send([0xf8]), 60000 / bpm / 24);
    },
    stopClock() { clearInterval(timer); timer = null; send([0xfc]); },
  };
})();`;

/**
 * A local WebSocket server standing in for a bridge (OSC on 8080, MCP on
 * 57132). `send(obj)` goes to every connected page; `request(cmd, args)`
 * does an MCP-style round trip.
 */
export function bridgeServer(port) {
  // No host: listen on every interface (IPv4 + IPv6), so ws://localhost works
  // whichever address 'localhost' resolves to first.
  const wss = new WebSocketServer({ port });
  const pending = new Map();
  let nextId = 1;
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      } catch { /* not ours */ }
    });
  });
  const api = {
    get connected() { return wss.clients.size; },
    send(obj) { for (const c of wss.clients) c.send(JSON.stringify(obj)); },
    request(cmd, args = {}) {
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        api.send({ id, cmd, args });
        setTimeout(() => { if (pending.delete(id)) resolve({ ok: false, error: 'timeout' }); }, 4000);
      });
    },
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }),
  };
  return api;
}
