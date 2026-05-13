/**
 * Web MIDI orchestration.
 *
 * - Requests MIDIAccess (sysex disabled — we don't need it).
 * - Tracks live input/output device lists, fires listeners on change.
 * - Routes incoming messages to MidiClock (always) and MidiMapping (always).
 * - Persists the user's chosen input/output device IDs in Settings, and
 *   re-attaches those devices when they reappear (USB reconnect).
 * - Provides `sendCC()` for both 7- and 14-bit CCs to drive external gear
 *   from ModMatrix slots.
 *
 * Feature-detect: if `navigator.requestMIDIAccess` is not present (Safari),
 * `available === false` and the manager is a no-op.
 */

import { SettingsStore } from '../state/Settings';
import { MidiClock } from './MidiClock';
import { MidiMapping } from './MidiMapping';

// Web MIDI types are global in TS DOM lib.
type WMIDIInput = MIDIInput;
type WMIDIOutput = MIDIOutput;
type WMIDIAccess = MIDIAccess;
type WMIDIMessageEvent = MIDIMessageEvent;

interface State {
  inputs: WMIDIInput[];
  outputs: WMIDIOutput[];
  selectedInputId: string;
  selectedOutputId: string;
  available: boolean;
  permission: 'unknown' | 'granted' | 'denied';
}

type Listener = (s: State) => void;

export class MidiManager {
  readonly available: boolean;
  private access: WMIDIAccess | null = null;
  private state: State;
  private listeners = new Set<Listener>();
  private currentInput: WMIDIInput | null = null;
  private currentOutput: WMIDIOutput | null = null;
  private boundOnMessage: ((e: WMIDIMessageEvent) => void) | null = null;

  constructor(
    private settings: SettingsStore,
    readonly clock: MidiClock,
    readonly mapping: MidiMapping,
  ) {
    this.available = typeof (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function';
    this.state = {
      inputs: [],
      outputs: [],
      selectedInputId: settings.get('midiInputId'),
      selectedOutputId: settings.get('midiOutputId'),
      available: this.available,
      permission: 'unknown',
    };

    settings.subscribe('midiInputId',  (id) => { this.state.selectedInputId  = id; this.attachInput();  this.notify(); });
    settings.subscribe('midiOutputId', (id) => { this.state.selectedOutputId = id; this.attachOutput(); this.notify(); });
  }

  /** Lazily request MIDI access. Idempotent; first call may show the prompt. */
  async ensure(): Promise<boolean> {
    if (!this.available) return false;
    if (this.access) return true;
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false, software: false });
      this.access = access;
      this.state.permission = 'granted';
      access.onstatechange = () => this.refreshDevices();
      this.refreshDevices();
      return true;
    } catch (err) {
      this.state.permission = 'denied';
      console.warn('MIDI access denied:', err);
      this.notify();
      return false;
    }
  }

  getState(): Readonly<State> {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  /** Send a Control Change message on the chosen output. */
  sendCC(channel: number, cc: number, value01: number, opts: { value14?: boolean } = {}): void {
    const out = this.currentOutput;
    if (!out) return;
    const ch = Math.max(1, Math.min(16, channel | 0));
    const status = 0xB0 | (ch - 1);

    if (opts.value14) {
      const val14 = Math.max(0, Math.min(16383, Math.round(value01 * 16383)));
      const msb = (val14 >> 7) & 0x7F;
      const lsb = val14 & 0x7F;
      const lsbCC = (cc + 32) & 0x7F;
      try {
        out.send([status, cc & 0x7F, msb]);
        out.send([status, lsbCC, lsb]);
      } catch (err) {
        console.warn('sendCC14 failed', err);
      }
    } else {
      const val7 = Math.max(0, Math.min(127, Math.round(value01 * 127)));
      try {
        out.send([status, cc & 0x7F, val7]);
      } catch (err) {
        console.warn('sendCC failed', err);
      }
    }
  }

  /** Send a Note On (velocity > 0) or Note Off (velocity 0). */
  sendNote(channel: number, note: number, velocity01: number): void {
    const out = this.currentOutput;
    if (!out) return;
    const ch = Math.max(1, Math.min(16, channel | 0));
    const v = Math.max(0, Math.min(127, Math.round(velocity01 * 127)));
    const status = (v > 0 ? 0x90 : 0x80) | (ch - 1);
    try {
      out.send([status, note & 0x7F, v]);
    } catch (err) {
      console.warn('sendNote failed', err);
    }
  }

  // -------------------- internals --------------------

  private refreshDevices(): void {
    if (!this.access) return;
    const inputs: WMIDIInput[] = [];
    const outputs: WMIDIOutput[] = [];
    this.access.inputs.forEach((i: WMIDIInput) => inputs.push(i));
    this.access.outputs.forEach((o: WMIDIOutput) => outputs.push(o));
    this.state.inputs = inputs;
    this.state.outputs = outputs;
    this.attachInput();
    this.attachOutput();
    this.notify();
  }

  private attachInput(): void {
    if (this.currentInput && this.boundOnMessage) {
      this.currentInput.removeEventListener('midimessage', this.boundOnMessage as unknown as EventListener);
      this.currentInput = null;
    }
    const id = this.state.selectedInputId;
    if (!id) return;
    const next = this.state.inputs.find((i) => i.id === id);
    if (!next) return;
    this.boundOnMessage = (e) => this.onMessage(e);
    next.addEventListener('midimessage', this.boundOnMessage as unknown as EventListener);
    this.currentInput = next;
  }

  private attachOutput(): void {
    const id = this.state.selectedOutputId;
    this.currentOutput = id ? this.state.outputs.find((o) => o.id === id) ?? null : null;
  }

  private onMessage(e: MIDIMessageEvent): void {
    const data = e.data;
    if (!data) return;
    const arr = data as Uint8Array;
    this.clock.handle(arr);
    this.mapping.handle(arr);
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}
