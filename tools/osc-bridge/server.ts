/**
 * UDP <-> WebSocket OSC bridge.
 *
 * The browser cannot send/receive UDP, so this tiny Node service translates
 * OSC packets between a UDP socket (TouchOSC, Lemur, Max, SuperCollider, etc.)
 * and a JSON-over-WebSocket connection (the Rutt/Etra web app).
 *
 * Protocol on the WS side (one JSON object per OSC packet):
 *   { "address": "/dcu/intensity", "args": [0.74] }
 *
 *   - args may contain numbers, strings, or booleans.
 *   - Outgoing messages from the browser are forwarded as OSC to UDP_HOST:UDP_OUT_PORT.
 *   - Incoming OSC packets on UDP_IN_PORT are forwarded to all WebSocket clients.
 *
 * Configuration (env or CLI):
 *   UDP_IN_PORT      (default 8000)  port we listen for incoming OSC on
 *   UDP_OUT_HOST     (default 127.0.0.1) where we send outgoing OSC
 *   UDP_OUT_PORT     (default 9000)  port we send outgoing OSC to
 *   WS_PORT          (default 8080)  WebSocket port the browser connects to
 */

import { Server as OscServer, Client as OscClient } from 'node-osc';
import { WebSocketServer, WebSocket } from 'ws';

const UDP_IN_PORT  = parseInt(process.env.UDP_IN_PORT  ?? '8000', 10);
const UDP_OUT_HOST = process.env.UDP_OUT_HOST ?? '127.0.0.1';
const UDP_OUT_PORT = parseInt(process.env.UDP_OUT_PORT ?? '9000', 10);
const WS_PORT      = parseInt(process.env.WS_PORT      ?? '8080', 10);

interface OscJson {
  address: string;
  args: (number | string | boolean)[];
}

const oscIn = new OscServer(UDP_IN_PORT, '0.0.0.0', () => {
  console.log(`[osc-bridge] listening for OSC on UDP :${UDP_IN_PORT}`);
});

const oscOut = new OscClient(UDP_OUT_HOST, UDP_OUT_PORT);
console.log(`[osc-bridge] sending OSC to ${UDP_OUT_HOST}:${UDP_OUT_PORT}`);

const wss = new WebSocketServer({ port: WS_PORT });
console.log(`[osc-bridge] WebSocket on :${WS_PORT}  (ws://localhost:${WS_PORT})`);

const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[osc-bridge] WS client connected (total: ${clients.size})`);
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as OscJson;
      if (typeof msg.address === 'string' && Array.isArray(msg.args)) {
        oscOut.send(msg.address, ...msg.args, () => { /* ack */ });
      }
    } catch (err) {
      console.warn('[osc-bridge] bad incoming WS message', err);
    }
  });
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[osc-bridge] WS client disconnected (total: ${clients.size})`);
  });
});

oscIn.on('message', (msg) => {
  // node-osc messages are: [address, ...args]
  const [address, ...args] = msg as [string, ...(number | string | boolean)[]];
  const json = JSON.stringify({ address, args });
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(json);
  }
});

function shutdown() {
  console.log('[osc-bridge] shutting down');
  try { oscIn.close(); } catch {}
  try { oscOut.close(); } catch {}
  for (const ws of clients) { try { ws.close(); } catch {} }
  try { wss.close(); } catch {}
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
