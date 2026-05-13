/**
 * OSC client over WebSocket.
 *
 * The browser cannot send/receive UDP directly, so we use a tiny Node bridge
 * (see `tools/osc-bridge/`) that translates UDP <-> WebSocket. The wire
 * format is one JSON message per OSC packet:
 *
 *   inbound:  { address: '/dcu/intensity', args: [0.74] }
 *   outbound: { address: '/foo/bar', args: [0.5, 'hi'] }
 *
 * On each incoming message we:
 *   1) update a per-address last-value cache used by the `osc` ModSource,
 *   2) apply any matching `OscBinding` to its target Settings key,
 *   3) resolve any pending learn() call by capturing the message as a fresh
 *      binding template.
 *
 * Reconnects with exponential backoff (1s -> 30s cap).
 */

import { applyCurve } from '../midi/MidiMapping';
import { OscBinding, Settings, SettingsStore } from '../state/Settings';

export type OscStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface OscMessage {
  address: string;
  args: (number | string | boolean)[];
}

type StatusListener = (s: OscStatus) => void;
type MessageListener = (m: OscMessage) => void;

export class OscClient {
  private ws: WebSocket | null = null;
  private status: OscStatus = 'idle';
  private statusListeners = new Set<StatusListener>();
  private messageListeners = new Set<MessageListener>();
  private wantConnected = false;
  private reconnectMs = 1000;
  private reconnectTimer: number | null = null;
  private learnPending: { resolve: (b: OscBinding) => void; reject: (e: Error) => void; target: string } | null = null;
  private mostRecentValue = 0;
  private valueCache = new Map<string, number>(); // `${address}:${argIndex}` -> 0..1

  constructor(private settings: SettingsStore) {
    settings.subscribe('oscBridgeUrl', () => {
      if (this.wantConnected) {
        this.disconnect();
        this.connect();
      }
    });
    if (settings.get('oscAutoConnect')) this.connect();
  }

  getStatus(): OscStatus {
    return this.status;
  }

  /** Most recent normalized value seen on any incoming message — for `osc` ModSource. */
  getMostRecent(): number {
    return this.mostRecentValue;
  }

  /** Value cached for an exact (address, argIndex) pair. */
  getValue(address: string, argIndex: number): number {
    return this.valueCache.get(`${address}:${argIndex}`) ?? 0;
  }

  subscribe(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  /** Direct subscription to incoming OSC messages (e.g. the section UI). */
  subscribeMessages(fn: MessageListener): () => void {
    this.messageListeners.add(fn);
    return () => this.messageListeners.delete(fn);
  }

  connect(): void {
    this.wantConnected = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    const url = this.settings.get('oscBridgeUrl');
    if (!url) return;
    this.setStatus('connecting');
    try {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => {
        this.reconnectMs = 1000;
        this.setStatus('connected');
      };
      ws.onmessage = (e) => this.handleRaw(e.data);
      ws.onerror = () => this.setStatus('error');
      ws.onclose = () => {
        this.ws = null;
        if (this.wantConnected) this.scheduleReconnect();
        else this.setStatus('idle');
      };
    } catch (err) {
      console.warn('OSC connect failed', err);
      this.setStatus('error');
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.wantConnected = false;
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch { /* noop */ }
      this.ws = null;
    }
    this.setStatus('idle');
  }

  send(msg: OscMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err) {
      console.warn('OSC send failed', err);
    }
  }

  /** Wait for the next incoming OSC message and create a binding from it. */
  learn(target: string): Promise<OscBinding> {
    if (this.learnPending) this.learnPending.reject(new Error('Learn cancelled'));
    return new Promise((resolve, reject) => {
      this.learnPending = { target, resolve, reject };
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

  updateBinding(id: string, patch: Partial<OscBinding>): void {
    const list = this.settings.get('oscBindings').map((b) => b.id === id ? { ...b, ...patch } : b);
    this.settings.set('oscBindings', list);
  }

  removeBinding(id: string): void {
    const list = this.settings.get('oscBindings').filter((b) => b.id !== id);
    this.settings.set('oscBindings', list);
  }

  // -------------------- internals --------------------

  private handleRaw(raw: unknown): void {
    let msg: OscMessage | null = null;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : null;
      if (parsed && typeof parsed.address === 'string' && Array.isArray(parsed.args)) {
        msg = parsed as OscMessage;
      }
    } catch { /* fall through */ }
    if (!msg) return;

    for (const fn of this.messageListeners) fn(msg);

    // Cache numeric args 0..1 by index.
    for (let i = 0; i < msg.args.length; i++) {
      const a = msg.args[i];
      if (typeof a === 'number') {
        const v01 = clamp01(a);
        this.valueCache.set(`${msg.address}:${i}`, v01);
        this.mostRecentValue = v01;
      }
    }

    if (this.learnPending) {
      const arg = msg.args.findIndex((a) => typeof a === 'number');
      if (arg >= 0) {
        const pending = this.learnPending;
        this.learnPending = null;
        const newBinding: OscBinding = {
          id: newId(),
          address: msg.address,
          argIndex: arg,
          target: pending.target,
          curve: 'linear',
          min: 0,
          max: 1,
        };
        const list = [...this.settings.get('oscBindings'), newBinding];
        this.settings.set('oscBindings', list);
        pending.resolve(newBinding);
      }
    }

    const bindings = this.settings.get('oscBindings');
    for (const b of bindings) {
      if (b.address !== msg.address) continue;
      const v = msg.args[b.argIndex];
      if (typeof v !== 'number') continue;
      const v01 = clamp01(v);
      const curved = applyCurve(v01, b.curve);
      const out = b.min + curved * (b.max - b.min);
      const key = b.target as keyof Settings;
      const cur = this.settings.get(key);
      if (typeof cur !== 'number') continue;
      this.settings.set(key, out as any);
    }
  }

  private setStatus(s: OscStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer != null) return;
    this.setStatus('error');
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantConnected) {
        this.reconnectMs = Math.min(30_000, this.reconnectMs * 2);
        this.connect();
      }
    }, this.reconnectMs);
  }
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

let idCounter = 0;
function newId(): string {
  return `o${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}
