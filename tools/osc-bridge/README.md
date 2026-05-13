# Rutt/Etra OSC bridge

A ~80-line UDP &harr; WebSocket bridge so the browser can speak OSC.

The browser cannot open a UDP socket, but TouchOSC / Lemur / Max / SuperCollider all speak UDP-OSC. This service sits in the middle: it receives OSC over UDP and forwards it to the web app as JSON over WebSocket, and vice versa.

## Quick start

```bash
cd tools/osc-bridge
npm install
npm run dev          # uses tsx, no build step
# or
npm start            # runs the compiled server.js (after `tsc`)
```

By default it listens on:

| Direction | Port | Notes |
| --- | --- | --- |
| UDP in (from controller) | `8000` | OSC packets received here are forwarded to the browser |
| UDP out (to controller)  | `9000` | OSC packets sent from the browser go here |
| WebSocket | `8080` | the browser connects to `ws://localhost:8080` |

Override any of these with env vars: `UDP_IN_PORT`, `UDP_OUT_HOST`, `UDP_OUT_PORT`, `WS_PORT`.

In the synth's **I/O &rarr; OSC** panel, set the bridge URL to `ws://localhost:8080` (the default) and click **Connect**.

## Wire format

Each OSC packet is one JSON message:

```json
{ "address": "/dcu/zpush", "args": [0.74] }
```

- `address` is the OSC address pattern (string).
- `args` is an array of numbers, strings, or booleans. The synth treats numeric args 0&hellip;1 as control values; values outside that range are clamped.

Bidirectional: messages sent from the browser via `OscClient.send()` are forwarded as OSC to `UDP_OUT_HOST:UDP_OUT_PORT`. Incoming OSC on `UDP_IN_PORT` is broadcast to all connected WebSocket clients.

## TouchOSC

1. Build a layout in TouchOSC Editor: faders -> `/dcu/zpush`, `/dcu/intensity`, etc.
2. In the TouchOSC app's connection settings, set the host to your machine's LAN IP and the OSC out port to `8000` (the bridge's `UDP_IN_PORT`).
3. Start the bridge, open the synth, hit **Connect** in the OSC panel, then click **Learn** on a binding row and wiggle the matching fader.

A starter layout JSON can be exported from the **Copy TouchOSC layout** button in the OSC panel — paste it into TouchOSC Editor as the basis of a new layout.

## Max / MSP

```max
[udpsend localhost 8000]    // to the bridge
[udpreceive 9000]           // from the bridge
```

## SuperCollider

```supercollider
~bridge = NetAddr("127.0.0.1", 8000);
~bridge.sendMsg("/dcu/intensity", 0.5);
```

## Security note

The bridge has zero auth and listens on all interfaces. Only run it on machines you trust on networks you trust. For remote use, tunnel through SSH or place it behind a reverse proxy with auth.
