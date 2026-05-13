/**
 * MIDI binding registry.
 *
 * Owns the live `MidiBinding[]` mirrored to `settings.midiBindings`. Parses
 * incoming MIDI messages and either:
 *   1) writes the scaled value into the bound Settings key (control bindings)
 *   2) updates a last-value cache so the ModMatrix can read raw MIDI signals
 *      as mod sources ('midiCC', 'midiNote', 'midiVelocity')
 *
 * Also exposes a `learn(target, opts)` helper that resolves with the next
 * matching message and creates a fresh binding from it. The UI uses this for
 * the "click learn → wiggle a knob" workflow.
 */

import { BindingCurve, MidiBinding, Settings, SettingsStore } from '../state/Settings';

export type LearnKind = 'cc' | 'note' | 'cc14';

interface ParsedMsg {
  status: number;
  channel: number;       // 1..16
  data1: number;
  data2: number;
}

interface PolyState {
  notes: Map<number, number>; // note -> velocity
  lastNote: number | null;
  lastVelocity: number;
}

type Listener = (bindings: MidiBinding[]) => void;

export class MidiMapping {
  /** Last raw value (0..1) per binding id, used by ModMatrix sources. */
  private lastValues = new Map<string, number>();

  /** 14-bit MSB cache: key = `${channel}:${ccMSB}` -> last MSB byte. */
  private msbCache = new Map<string, number>();

  /** Per-channel polyphonic note tracking. */
  private polyByChannel = new Map<number, PolyState>();

  /** Last received CC value (0..1) per `${channel}:${cc}`, for 'midiCC' source. */
  private rawCCs = new Map<string, number>();

  private learnPending: { kind: LearnKind | null; resolve: (b: MidiBinding) => void; reject: (e: Error) => void } | null = null;

  private listeners = new Set<Listener>();

  constructor(private settings: SettingsStore) {
    settings.subscribe('midiBindings', (b) => {
      // Drop cached values for ids that no longer exist
      const ids = new Set(b.map((x) => x.id));
      for (const id of [...this.lastValues.keys()]) {
        if (!ids.has(id)) this.lastValues.delete(id);
      }
      for (const fn of this.listeners) fn(b);
    });
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.settings.get('midiBindings'));
    return () => this.listeners.delete(fn);
  }

  /** Process an incoming raw MIDI message. Ignores clock-only bytes. */
  handle(data: Uint8Array | number[]): void {
    if (data.length === 0) return;
    const status = data[0];

    // System realtime / sysex — not handled here.
    if (status >= 0xF0) return;

    const msg = parseChannelMsg(data);
    if (!msg) return;

    // Track polyphonic note state for any channel.
    this.updatePolyState(msg);

    // Update raw CC cache for 'midiCC' mod source.
    if (msg.status === 0xB0) {
      this.rawCCs.set(`${msg.channel}:${msg.data1}`, msg.data2 / 127);
    }

    // Resolve any pending learn.
    if (this.learnPending) {
      const learned = this.tryLearn(msg);
      if (learned) {
        const pending = this.learnPending;
        this.learnPending = null;
        pending.resolve(learned);
      }
    }

    // Apply each matching binding.
    const bindings = this.settings.get('midiBindings');
    for (const b of bindings) {
      const v = this.matchAndScale(b, msg);
      if (v == null) continue;
      this.lastValues.set(b.id, v);
      this.applyToTarget(b, v);
    }
  }

  /** Returns the last 0..1 value seen for a binding id (or 0). */
  getLast(id: string): number {
    return this.lastValues.get(id) ?? 0;
  }

  /** Returns the last 0..1 raw CC value for a (channel, cc) — used by `midiCC` source. */
  getRawCC(channel: number, cc: number): number {
    return this.rawCCs.get(`${channel}:${cc}`) ?? 0;
  }

  /** Last polyphonic note state for a channel — used by `midiNote`/`midiVelocity` sources. */
  getPoly(channel: number): PolyState {
    let s = this.polyByChannel.get(channel);
    if (!s) {
      s = { notes: new Map(), lastNote: null, lastVelocity: 0 };
      this.polyByChannel.set(channel, s);
    }
    return s;
  }

  /**
   * Begin a learn capture. Resolves with a freshly created binding (already
   * pushed onto `settings.midiBindings`) when the next matching message arrives.
   * The caller can edit the returned binding in place via `updateBinding()`.
   */
  learn(target: string, kind: LearnKind | null = null): Promise<MidiBinding> {
    if (this.learnPending) this.learnPending.reject(new Error('Learn cancelled'));
    return new Promise((resolve, reject) => {
      this.learnPending = {
        kind,
        resolve: (bindingFromMsg) => {
          const newBinding: MidiBinding = {
            ...bindingFromMsg,
            id: bindingFromMsg.id || newId(),
            target,
          };
          const list = [...this.settings.get('midiBindings'), newBinding];
          this.settings.set('midiBindings', list);
          resolve(newBinding);
        },
        reject,
      };
    });
  }

  cancelLearn(): void {
    if (this.learnPending) {
      this.learnPending.reject(new Error('Learn cancelled'));
      this.learnPending = null;
    }
  }

  isLearning(): boolean {
    return this.learnPending != null;
  }

  /** Patch an existing binding by id and persist. */
  updateBinding(id: string, patch: Partial<MidiBinding>): void {
    const list = this.settings.get('midiBindings').map((b) =>
      b.id === id ? { ...b, ...patch } : b,
    );
    this.settings.set('midiBindings', list);
  }

  removeBinding(id: string): void {
    const list = this.settings.get('midiBindings').filter((b) => b.id !== id);
    this.settings.set('midiBindings', list);
  }

  // -------------------- internals --------------------

  private tryLearn(msg: ParsedMsg): MidiBinding | null {
    // Only seed bindings from CC messages or note-ons (velocity > 0).
    if (msg.status === 0xB0) {
      // Standard 7-bit CC for now; user can convert to cc14 by editing.
      return {
        id: newId(),
        type: 'cc',
        channel: msg.channel,
        controller: msg.data1,
        target: '',
        curve: 'linear',
        min: 0,
        max: 1,
      };
    }
    if (msg.status === 0x90 && msg.data2 > 0) {
      return {
        id: newId(),
        type: 'note',
        channel: msg.channel,
        controller: msg.data1,
        target: '',
        curve: 'linear',
        min: 0,
        max: 1,
        noteMode: 'last',
        velocityScale: 1,
      };
    }
    return null;
  }

  /** Returns 0..1 normalized value if `b` matches `msg`, else null. */
  private matchAndScale(b: MidiBinding, msg: ParsedMsg): number | null {
    const channelMatches = b.channel === 0 || b.channel === msg.channel;
    if (!channelMatches) return null;

    if (b.type === 'cc' && msg.status === 0xB0 && msg.data1 === b.controller) {
      return msg.data2 / 127;
    }

    if (b.type === 'cc14' && msg.status === 0xB0) {
      const lsbCC = b.controllerLsb ?? (b.controller + 32);
      if (msg.data1 === b.controller) {
        // MSB
        this.msbCache.set(`${msg.channel}:${b.controller}`, msg.data2);
        const lsb = this.lastLsbFor(msg.channel, lsbCC);
        return ((msg.data2 << 7) | lsb) / 16383;
      }
      if (msg.data1 === lsbCC) {
        const msb = this.msbCache.get(`${msg.channel}:${b.controller}`) ?? 0;
        return ((msb << 7) | msg.data2) / 16383;
      }
      return null;
    }

    if (b.type === 'note') {
      if ((msg.status === 0x90 || msg.status === 0x80) && msg.data1 === b.controller) {
        const isOn = msg.status === 0x90 && msg.data2 > 0;
        return isOn ? (msg.data2 / 127) * (b.velocityScale ?? 1) : 0;
      }
      return null;
    }

    return null;
  }

  /** Apply a 0..1 value to the binding's target Settings key, with curve+range. */
  private applyToTarget(b: MidiBinding, v01: number): void {
    if (!b.target) return;
    const v = applyCurve(v01, b.curve);
    const out = b.min + v * (b.max - b.min);
    // Skip if not a valid Settings key
    const key = b.target as keyof Settings;
    const cur = this.settings.get(key);
    if (typeof cur !== 'number') return;
    this.settings.set(key, out as any);
  }

  private updatePolyState(msg: ParsedMsg): void {
    const poly = this.getPoly(msg.channel);
    if (msg.status === 0x90 && msg.data2 > 0) {
      poly.notes.set(msg.data1, msg.data2);
      poly.lastNote = msg.data1;
      poly.lastVelocity = msg.data2;
    } else if (msg.status === 0x80 || (msg.status === 0x90 && msg.data2 === 0)) {
      poly.notes.delete(msg.data1);
      if (poly.notes.size === 0) poly.lastVelocity = 0;
    }
  }

  private lastLsbFor(channel: number, lsbCC: number): number {
    return Math.round((this.rawCCs.get(`${channel}:${lsbCC}`) ?? 0) * 127);
  }
}

// --------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------

function parseChannelMsg(data: Uint8Array | number[]): ParsedMsg | null {
  if (data.length < 2) return null;
  const statusByte = data[0];
  const status = statusByte & 0xF0;
  const channel = (statusByte & 0x0F) + 1;
  const data1 = data[1];
  const data2 = data.length >= 3 ? data[2] : 0;
  return { status, channel, data1, data2 };
}

export function applyCurve(v: number, curve: BindingCurve): number {
  const x = Math.max(0, Math.min(1, v));
  switch (curve) {
    case 'linear':   return x;
    case 'exp':      return x * x;
    case 'log':      return Math.sqrt(x);
    case 'inverted': return 1 - x;
  }
}

export function describeBindingSource(b: MidiBinding): string {
  const ch = b.channel === 0 ? 'omni' : `ch${b.channel}`;
  if (b.type === 'cc')   return `CC#${b.controller} ${ch}`;
  if (b.type === 'cc14') return `CC#${b.controller}/${b.controllerLsb ?? b.controller + 32} ${ch} (14-bit)`;
  if (b.type === 'note') return `Note ${b.controller} ${ch}`;
  return '';
}

let idCounter = 0;
function newId(): string {
  return `m${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}
