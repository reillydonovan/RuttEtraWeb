/**
 * RUTT/ETRA Web — MCP server.
 *
 * Bridges an MCP client (Claude Desktop, Claude Code, anything speaking
 * Model Context Protocol over stdio) to the synth running in a browser.
 * Topology mirrors tools/osc-bridge: this process hosts a local
 * WebSocket server; the BROWSER connects out to it (I/O → MCP →
 * Connect in the synth). Each MCP tool call is relayed as a JSON frame
 * { id, cmd, args } and answered by the in-app command surface
 * (src/io/McpRemote.ts).
 *
 *   MCP client ⇄ (stdio) ⇄ this process ⇄ (ws://localhost:57132) ⇄ browser
 *
 * Run: `npm install && npm start` in this directory, then Connect from
 * the synth's I/O → MCP section. Configure your MCP client with:
 *   { "command": "node", "args": ["<repo>/tools/mcp-server/server.mjs"] }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import { z } from 'zod';

const PORT = Number(process.env.MCP_BRIDGE_PORT ?? 57132);
const CALL_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------
// Browser relay
// ---------------------------------------------------------------------

let browser = null; // latest connected browser socket wins
let nextId = 1;
const pending = new Map(); // id -> { resolve, reject, timer }

const wss = new WebSocketServer({ port: PORT });
wss.on('connection', (ws) => {
  console.error(`[mcp-bridge] browser connected (${wss.clients.size} client(s))`);
  browser = ws;
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error ?? 'browser reported an error'));
  });
  ws.on('close', () => {
    if (browser === ws) browser = null;
    console.error('[mcp-bridge] browser disconnected');
  });
});
console.error(`[mcp-bridge] WebSocket relay listening on ws://localhost:${PORT}`);

function call(cmd, args = {}) {
  return new Promise((resolve, reject) => {
    if (!browser || browser.readyState !== 1) {
      reject(new Error(
        'No browser connected. Open the synth, then I/O → MCP → Connect '
        + `(URL ws://localhost:${PORT}).`,
      ));
      return;
    }
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`browser did not answer "${cmd}" within ${CALL_TIMEOUT_MS}ms`));
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    browser.send(JSON.stringify({ id, cmd, args }));
  });
}

// ---------------------------------------------------------------------
// MCP server + tools
// ---------------------------------------------------------------------

const server = new McpServer({ name: 'ruttetra', version: '1.0.0' });

const text = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });

server.tool(
  'describe_app',
  'App name, version, and the full remote-command list the connected synth exposes.',
  {},
  async () => text(await call('describe')),
);

server.tool(
  'list_params',
  'Every modulatable synth parameter: key, label, current value, designed range, and description.',
  {},
  async () => text(await call('list_params')),
);

server.tool(
  'get_param',
  'Read one parameter\'s current base value by key (see list_params).',
  { key: z.string().describe('Settings key, e.g. "zPush"') },
  async ({ key }) => text(await call('get_param', { key })),
);

server.tool(
  'set_param',
  'Set one parameter\'s base value by key. Modulation (LFOs, CV, graph) keeps layering on top, exactly like turning the knob in the UI.',
  {
    key: z.string().describe('Settings key, e.g. "zPush"'),
    value: z.number().describe('New base value (see list_params for ranges)'),
  },
  async ({ key, value }) => text(await call('set_param', { key, value })),
);

server.tool(
  'get_settings',
  'Read arbitrary settings keys (or the full settings snapshot when keys is omitted). Read-only.',
  { keys: z.array(z.string()).optional().describe('Settings keys to read; omit for everything') },
  async ({ keys }) => text(await call('get_settings', { keys })),
);

server.tool(
  'list_actions',
  'Every registered app command (menu bar / shortcuts): id, label, shortcut, enabled. Run one with run_action.',
  {},
  async () => text(await call('list_actions')),
);

server.tool(
  'run_action',
  'Run a registered app command by id (see list_actions) — save project, start tutorial, toggle fullscreen, load sample patch, etc.',
  { id: z.string().describe('Action id, e.g. "file.save"') },
  async ({ id }) => text(await call('run_action', { id })),
);

server.tool(
  'get_graph_patch',
  'The current modulation graph patch (nodes + bindings) as JSON, or null if none exists.',
  {},
  async () => text(await call('get_graph_patch')),
);

server.tool(
  'set_graph_patch',
  'Replace the whole modulation graph patch. Pass { nodes: [], bindings: [] } JSON (see get_graph_patch for the shape) or null to clear.',
  { patch: z.string().describe('JSON: { nodes, bindings } or "null"') },
  async ({ patch }) => text(await call('set_graph_patch', { patch: JSON.parse(patch) })),
);

server.tool(
  'add_graph_node',
  'Add one node to the graph patch by type (see list_node_types). Returns the new node id.',
  { type: z.string().describe('Node type, e.g. "lfo", "scope", "audio-envelope"') },
  async ({ type }) => text(await call('add_graph_node', { type })),
);

server.tool(
  'list_node_types',
  'Every graph node type the engine supports: type, label, category, description.',
  {},
  async () => text(await call('list_node_types')),
);

server.tool(
  'screenshot',
  'Capture the current rendered output as a PNG image.',
  {},
  async () => {
    const dataUrl = await call('screenshot');
    const b64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
    return { content: [{ type: 'image', data: b64, mimeType: 'image/png' }] };
  },
);

await server.connect(new StdioServerTransport());
console.error('[mcp-bridge] MCP server ready on stdio');
