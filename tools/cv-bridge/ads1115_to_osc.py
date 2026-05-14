#!/usr/bin/env python3
"""
ADS1115 -> Rutt/Etra OSC bridge.

Same idea as the MCP3008 script, but using the higher-resolution
ADS1115 (16-bit, I2C, 4 single-ended or 2 differential channels).
Worth the upgrade if you want clean readings on slow CVs (envelopes,
LFOs at fractional Hz) where the MCP3008's 10-bit quantization noise
becomes audible.

Usage:
    python3 ads1115_to_osc.py --bridge ws://localhost:8080 --rate 50

Dependencies:
    pip3 install adafruit-circuitpython-ads1x15 websocket-client
"""

import argparse
import json
import time

import board
import busio
from adafruit_ads1x15.ads1115 import ADS1115
from adafruit_ads1x15.analog_in import AnalogIn
import websocket


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--bridge", default="ws://localhost:8080")
    p.add_argument("--rate", type=float, default=50.0,
                   help="Sample rate in Hz (default 50; ADS1115 maxes at ~860 SPS)")
    p.add_argument("--gain", type=float, default=1.0,
                   help="ADS1115 PGA gain (1=±4.096V, 2/3=±6.144V, 2=±2.048V, etc.)")
    args = p.parse_args()

    i2c = busio.I2C(board.SCL, board.SDA)
    adc = ADS1115(i2c)
    adc.gain = args.gain

    # ADS1115 supports 4 single-ended channels (P0..P3). We expose all 4.
    from adafruit_ads1x15.ads1x15 import (P0, P1, P2, P3)  # noqa: E501
    inputs = [AnalogIn(adc, ch) for ch in (P0, P1, P2, P3)]

    ws = websocket.create_connection(args.bridge)
    print(f"[cv-bridge] connected to {args.bridge}, gain=±{4.096 / args.gain:.3f}V")

    # Full-scale voltage at the configured gain.
    fs = 4.096 / args.gain
    interval = 1.0 / args.rate
    next_tick = time.monotonic()
    try:
        while True:
            for i, inp in enumerate(inputs):
                v = inp.voltage  # signed, in volts
                # Normalize to -1..1 around the PGA full-scale.
                norm = max(-1.0, min(1.0, v / fs))
                # Re-map to 0..1 so the synth's default OSC channel
                # config (`inMin=-5, inMax=+5`, polarity=bipolar) lands
                # zero where it belongs. The synth will subtract its
                # configured zero in turn.
                z01 = (norm + 1.0) * 0.5
                ws.send(json.dumps({"address": f"/cv/{i + 1}", "args": [z01]}))
            next_tick += interval
            sleep = next_tick - time.monotonic()
            if sleep > 0:
                time.sleep(sleep)
            else:
                next_tick = time.monotonic()
    except KeyboardInterrupt:
        print("\n[cv-bridge] shutting down")
    finally:
        ws.close()


if __name__ == "__main__":
    main()
