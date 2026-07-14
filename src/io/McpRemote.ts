/**
 * MCP remote-control client — the browser half of the MCP bridge.
 *
 * Topology mirrors the OSC bridge exactly: a small local Node process
 * (`tools/mcp-server/`) speaks MCP over stdio to the agent and relays
 * each tool call to this client over a WebSocket the BROWSER connects
 * out to. Opt-in like every I/O route: nothing connects until the user
 * clicks Connect in I/O → MCP (or enables auto-connect).
 *
 * The command surface is deliberately built from the app's OWN
 * single-source registries rather than a parallel API, so "control
 * anything" stays true as the app grows:
 *   - params:   `TARGETS` (every modulatable key) + base-value writes —
 *               the same `settings.set`-by-string-key pattern
 *               MidiMapping uses. Base writes only; the base/live split
 *               is untouched (modulation layers on top, as always).
 *   - actions:  the app-wide action registry (`ui/actions.ts`) — every
 *               menu-bar / shortcut command, run by id.
 *   - graph:    `modGraph` get/set/add-node with the same
 *               settings.set + engine.setPatch two-write every editing
 *               surface uses, plus the node-type registry for
 *               discovery.
 *   - settings: read-only snapshot of arbitrary keys for inspection.
 *   - screenshot: the render canvas as a PNG data URL, captured inside
 *               a rAF callback so the GL frame is fresh.
 *
 * Protocol: JSON frames { id, cmd, args } → { id, ok, result | error }.
 */

import type { Settings, SettingsStore } from '../state/Settings';
import type { GraphEngine } from '../modulation/graph/GraphEngine';
import type { GraphPatch, NodeType } from '../modulation/graph/types';
import { getDef, allDefs } from '../modulation/graph/registry';
import { TARGETS } from '../ui/targets';
import { PARAM_DOCS } from '../ui/help/paramDocs';
import { listActions, runAction } from '../ui/actions';

export type McpStatus = 'idle' | 'connecting' | 'connected' | 'error';

export interface McpRemoteDeps {
  settings: SettingsStore;
  getEngine: () => Promise<GraphEngine>;
}

export class McpRemote {
  private ws: WebSocket | null = null;
  private status: McpStatus = 'idle';
  private listeners = new Set<(s: McpStatus) => void>();

  constructor(private deps: McpRemoteDeps) {}

  subscribe(fn: (s: McpStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private setStatus(s: McpStatus): void {
    this.status = s;
    for (const fn of this.listeners) fn(s);
  }

  connect(): void {
    this.disconnect();
    const url = this.deps.settings.get('mcpBridgeUrl');
    this.setStatus('connecting');
    try {
      this.ws = new WebSocket(url);
    } catch {
      this.setStatus('error');
      return;
    }
    this.ws.addEventListener('open', () => this.setStatus('connected'));
    this.ws.addEventListener('close', () => { if (this.status !== 'error') this.setStatus('idle'); });
    this.ws.addEventListener('error', () => this.setStatus('error'));
    this.ws.addEventListener('message', (ev) => void this.onMessage(String(ev.data)));
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.setStatus('idle');
  }

  private async onMessage(raw: string): Promise<void> {
    let msg: { id?: unknown; cmd?: unknown; args?: unknown };
    try { msg = JSON.parse(raw); } catch { return; }
    if (typeof msg.id !== 'string' && typeof msg.id !== 'number') return;
    const reply = (body: object): void => {
      this.ws?.send(JSON.stringify({ id: msg.id, ...body }));
    };
    try {
      const result = await this.execute(String(msg.cmd), (msg.args ?? {}) as Record<string, unknown>);
      reply({ ok: true, result });
    } catch (err) {
      reply({ ok: false, error: (err as Error).message });
    }
  }

  // ------------------------- command surface -------------------------

  private async execute(cmd: string, args: Record<string, unknown>): Promise<unknown> {
    const { settings } = this.deps;
    switch (cmd) {
      case 'describe':
        return {
          app: 'ruttetra-web',
          version: readAppVersion(),
          commands: [
            'describe', 'list_params', 'get_param', 'set_param', 'get_settings',
            'list_actions', 'run_action', 'get_graph_patch', 'set_graph_patch',
            'add_graph_node', 'list_node_types', 'screenshot',
          ],
        };

      case 'list_params':
        return TARGETS.map((t) => {
          const key = String(t.v);
          const doc = PARAM_DOCS[key];
          const cur = settings.get(key as keyof Settings);
          return {
            key, label: t.l,
            value: typeof cur === 'number' ? cur : null,
            range: doc?.range ?? null,
            description: doc?.description ?? null,
          };
        });

      case 'get_param': {
        const v = settings.get(requireString(args, 'key') as keyof Settings);
        if (typeof v !== 'number') throw new Error(`"${args.key}" is not a numeric param`);
        return v;
      }

      case 'set_param': {
        const key = requireString(args, 'key') as keyof Settings;
        const value = args.value;
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('value must be a finite number');
        if (typeof settings.get(key) !== 'number') throw new Error(`"${String(key)}" is not a numeric param`);
        settings.set(key, value as never);
        return settings.get(key);
      }

      case 'get_settings': {
        const keys = Array.isArray(args.keys) ? (args.keys as string[]) : null;
        if (!keys) return settings.all;
        const out: Record<string, unknown> = {};
        for (const k of keys) out[k] = settings.get(k as keyof Settings);
        return out;
      }

      case 'list_actions':
        return listActions();

      case 'run_action': {
        const ran = runAction(requireString(args, 'id'));
        if (!ran) throw new Error(`action "${args.id}" not found or disabled`);
        return true;
      }

      case 'get_graph_patch':
        return settings.get('modGraph');

      case 'set_graph_patch': {
        const patch = args.patch as GraphPatch | null;
        if (patch !== null && (typeof patch !== 'object' || !Array.isArray(patch.nodes) || !Array.isArray(patch.bindings))) {
          throw new Error('patch must be null or { nodes: [], bindings: [] }');
        }
        if (settings.get('modMode') === 'classic') settings.set('modMode', 'both');
        settings.set('modGraph', patch);
        const e = await this.deps.getEngine();
        e.setPatch(patch);
        return true;
      }

      case 'add_graph_node': {
        const type = requireString(args, 'type') as NodeType;
        const def = getDef(type);
        if (!def) throw new Error(`unknown node type "${type}" — see list_node_types`);
        const patch = settings.get('modGraph') ?? { nodes: [], bindings: [] };
        const inputs: Record<string, string | null> = {};
        for (const p of def.inputs) inputs[p.name] = null;
        const nodeId = `n${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
        const next: GraphPatch = {
          nodes: [...patch.nodes, { id: nodeId, type, params: {}, inputs }],
          bindings: [...patch.bindings, {
            id: `b${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`,
            paramKey: 'none', sourceNodeId: nodeId, amount: 0.25, mode: 'additive',
          }],
        };
        if (settings.get('modMode') === 'classic') settings.set('modMode', 'both');
        settings.set('modGraph', next);
        const e = await this.deps.getEngine();
        e.setPatch(next);
        return { nodeId };
      }

      case 'list_node_types':
        return allDefs().map((d) => ({
          type: d.type, label: d.label, category: d.category, description: d.description,
        }));

      case 'screenshot': {
        // Capture inside a rAF so the GL frame is freshly composited
        // (the render canvas doesn't preserve its drawing buffer).
        return await new Promise<string>((resolve, reject) => {
          requestAnimationFrame(() => {
            const stage = document.getElementById('stage') as HTMLCanvasElement | null;
            if (!stage) { reject(new Error('render canvas not found')); return; }
            const c = document.createElement('canvas');
            c.width = stage.width; c.height = stage.height;
            const ctx = c.getContext('2d');
            if (!ctx) { reject(new Error('2d context unavailable')); return; }
            ctx.drawImage(stage, 0, 0);
            resolve(c.toDataURL('image/png'));
          });
        });
      }

      default:
        throw new Error(`unknown command "${cmd}" — call describe for the list`);
    }
  }
}

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) throw new Error(`"${key}" (string) is required`);
  return v;
}

function readAppVersion(): string {
  try {
    if (typeof __BUILD_INFO__ !== 'undefined') return __BUILD_INFO__.version;
  } catch { /* fall through */ }
  return 'dev';
}
