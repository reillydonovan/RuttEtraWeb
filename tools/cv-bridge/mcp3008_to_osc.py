#!/usr/bin/env python3
"""
MCP3008 -> Rutt/Etra OSC bridge.

Reads all 8 channels of an MCP3008 ADC (Raspberry Pi SPI) and emits one
JSON-OSC message per channel per tick over the synth's existing
WebSocket bridge. Pair with `tools/osc-bridge/` running locally.

Wire format mirrors what the synth's OSC subsystem expects:

    {"address": "/cv/1", "args": [0.234]}

The synth's I/O panel has a "CV Inputs (OSC bridge)" section where users
add `/cv/N` channels and configure range mapping per channel. The
addresses emitted here are 1-indexed by convention.

Voltage scaling: the MCP3008 reads 0..3.3V. Eurorack ±5V CV needs a
voltage divider + offset to land in that range — see
`tools/cv-bridge/README.md` for the schematic. This script just reports
the normalized 0..1 ADC reading; the offset / scaling happens in the
synth's per-channel `inMin` / `inMax` config.

Usage:
    python3 mcp3008_to_osc.py --bridge ws://localhost:8080 --rate 100

Dependencies:
    pip3 install spidev websocket-client
"""

import argparse
import json
import time

import spidev
import websocket  # from `websocket-client`


def read_mcp3008(spi: spidev.SpiDev, channel: int) -> float:
    """Return a normalized 0..1 reading for one of the 8 channels."""
    if not 0 <= channel <= 7:
        raise ValueError("MCP3008 channel must be 0..7")
    # Single-ended mode, channel = ((1 << 7) | (channel << 4))
    cmd = [1, (8 + channel) << 4, 0]
    resp = spi.xfer2(cmd)
    raw = ((resp[1] & 3) << 8) | resp[2]
    return raw / 1023.0


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--bridge", default="ws://localhost:8080",
                   help="WebSocket URL of the synth's OSC bridge")
    p.add_argument("--rate", type=float, default=100.0,
                   help="Sample rate in Hz (default 100)")
    p.add_argument("--channels", type=int, default=8,
                   help="How many MCP3008 channels to read (1..8)")
    p.add_argument("--spi-bus", type=int, default=0)
    p.add_argument("--spi-cs", type=int, default=0)
    args = p.parse_args()

    spi = spidev.SpiDev()
    spi.open(args.spi_bus, args.spi_cs)
    spi.max_speed_hz = 1_350_000  # MCP3008 max ~1.35MHz

    ws = websocket.create_connection(args.bridge)
    print(f"[cv-bridge] connected to {args.bridge}, sampling {args.channels} channels @ {args.rate}Hz")

    interval = 1.0 / args.rate
    next_tick = time.monotonic()
    try:
        while True:
            for ch in range(args.channels):
                v = read_mcp3008(spi, ch)
                msg = json.dumps({"address": f"/cv/{ch + 1}", "args": [v]})
                ws.send(msg)
            next_tick += interval
            sleep = next_tick - time.monotonic()
            if sleep > 0:
                time.sleep(sleep)
            else:
                # We've fallen behind — skip-forward rather than spin.
                next_tick = time.monotonic()
    except KeyboardInterrupt:
        print("\n[cv-bridge] shutting down")
    finally:
        ws.close()
        spi.close()


if __name__ == "__main__":
    main()
