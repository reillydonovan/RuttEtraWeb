# Rutt/Etra CV bridge

A reference script that reads analog voltages from a hardware ADC and emits them as OSC messages that the synth's existing OSC subsystem already consumes. This is **Route C** from the v9 voltage-control plan — the path for users who want CV input but don't have a DC-coupled audio interface (Route A) handy.

The script targets cheap ADCs commonly attached to Raspberry Pi GPIO:

- **MCP3008** — 8 channels, 10-bit, SPI. Most popular Pi ADC HAT.
- **ADS1115** — 4 differential channels, 16-bit, I²C. More accurate; better for slow CVs.

For other hardware (Norns, Bela, Teensy) the same pattern works — read voltages on a poll loop, emit JSON-OSC over WebSocket to the synth.

## Wire format

The synth's existing OSC subsystem reads JSON messages over WebSocket. A CV bridge emits one message per channel per sample tick:

```json
{ "address": "/cv/1", "args": [0.234] }
```

By convention the address scheme is `/cv/<n>`, 1-indexed, mapping `args[0]` to a normalized 0..1 value (or pass the raw voltage if you've configured the OSC channel's `inMin`/`inMax` to match). The synth's **CV Inputs (OSC bridge)** section in the I/O panel lets the user reconfigure address + range mapping per channel.

The synth's bridge connection is the **regular OSC bridge** (`tools/osc-bridge`): point your CV bridge at the same WebSocket the OSC panel is connected to, and the messages flow through automatically. There's no separate CV WebSocket.

## Quick start (Raspberry Pi + MCP3008)

1. Wire the MCP3008 to the Pi via SPI (CS on CE0, DOUT/DIN/CLK on the SPI pins; VDD/VREF to 3.3V).
2. Enable SPI: `sudo raspi-config` → Interface → SPI → Yes → reboot.
3. Install deps:

   ```bash
   sudo apt install python3-pip
   pip3 install spidev websocket-client
   ```

4. Start the regular OSC bridge on the Pi (or any host on the LAN):

   ```bash
   cd ../osc-bridge
   npm install && npm run dev    # listens on ws://0.0.0.0:8080
   ```

5. Run the bridge:

   ```bash
   python3 mcp3008_to_osc.py --bridge ws://localhost:8080 --rate 100
   ```

6. In the synth's I/O panel:
   - Connect the OSC bridge.
   - Open the **CV Inputs (OSC bridge)** section.
   - Click **Add OSC CV channel** for each channel you want; the default address `/cv/N` matches the script.
   - Use the channel's source in any modulation patch — bind it to a target via Modulation as usual.

## Reference scripts

- `mcp3008_to_osc.py` — Python, MCP3008 over SPI on Raspberry Pi
- `ads1115_to_osc.py`  — Python, ADS1115 over I²C on Raspberry Pi (higher resolution)

Both follow the same pattern: read each channel, normalize to 0..1, emit `/cv/<n> <val>` at the configured rate. They're 30–40 lines each — copy into your own script as needed.

## Voltage scaling

The Pi's GPIO ADCs are limited to 0–3.3V, but Eurorack CV is ±5V. To bring Eurorack into range you need a voltage divider plus offset:

```
+5V ─┬─[10kΩ]─┬─ ADC input
     │         │
   CV in     [10kΩ]──+1.65V (mid-rail)
                │
              GND
```

This maps a -5V..+5V CV onto roughly 0..3.3V at the ADC. Adjust the resistor values for your reference voltage. **Don't connect Eurorack CV directly to the Pi's GPIO** — voltages outside 0–3.3V will damage the SoC.

For 0..5V unipolar CV (gates / envelopes), a single 10kΩ + 5.6kΩ divider works without the offset.

## Trigger / gate detection

The reference scripts emit raw voltages on a poll loop. Trigger / gate detection (rising-edge → emit a one-shot) is left as a follow-up; for v1, route a CV through a `comparator` graph node in the synth and use its gate output instead.

## Other hardware

- **Norns** — emit OSC from a script with `osc.send("localhost", 8000, "/cv/1", {value})`. The Norns OSC bridge reuses the same bridge.
- **Bela** — Bela's render loop has direct ADC access; emit `liblo`-style OSC over UDP and the existing OSC bridge translates UDP↔WebSocket.
- **Teensy + USB serial** — emit a tiny JSON-over-serial protocol from the Teensy, then a 5-line Node script translates serial → WebSocket → synth.
