# RUTT/ETRA Web — MCP server

Remote-control the synth from any MCP client (Claude Desktop, Claude
Code, or anything else speaking the Model Context Protocol).

## How it works

```
MCP client ⇄ (stdio) ⇄ server.mjs ⇄ ws://localhost:57132 ⇄ browser tab
```

Same topology as `tools/osc-bridge`: this process hosts a local
WebSocket relay; the **browser connects out to it** — nothing can reach
into the synth until you click Connect in-app (opt-in, like every I/O
route).

## Setup

1. `npm install && npm start` in this directory.
2. Open the synth, go to **I/O → MCP**, click **Connect**
   (URL defaults to `ws://localhost:57132`; enable *Auto-connect on
   startup* if you want it every session).
3. Point your MCP client at the server, e.g. for Claude Desktop /
   Claude Code:

```json
{
  "mcpServers": {
    "ruttetra": {
      "command": "node",
      "args": ["<absolute path to repo>/tools/mcp-server/server.mjs"]
    }
  }
}
```

Override the relay port with `MCP_BRIDGE_PORT` (update the in-app URL
to match).

**Security.** Whoever connects to the relay gets full remote control of
the synth (params, menu actions, graph edits, canvas screenshots), so it
is locked down by default:

- it listens on `127.0.0.1` only (`MCP_BRIDGE_HOST` to change — don't
  expose it on a shared network such as a venue's Wi-Fi);
- it accepts browser connections only from `https://ruttetraweb.com`,
  `https://www.ruttetraweb.com` and localhost dev/preview servers on any
  port — any other website open in the same browser is refused. Add
  origins with `MCP_BRIDGE_ORIGINS="https://example.com,https://other"`.

## Tools

| Tool | What it does |
| --- | --- |
| `describe_app` | App version + the command list the connected synth exposes. |
| `list_params` | Every modulatable parameter: key, label, current value, range, description. |
| `get_param` / `set_param` | Read / write one parameter's **base** value by key — identical to turning the knob; modulation keeps layering on top (base/live split untouched). |
| `get_settings` | Read arbitrary settings keys, or the full snapshot. Read-only. |
| `list_actions` / `run_action` | Discover and run every registered app command (the menu bar's registry): save/open project, load sample patch, layout presets, tutorials, fullscreen, ... |
| `get_graph_patch` / `set_graph_patch` | Read / replace the modulation graph (nodes + bindings) as JSON. |
| `add_graph_node` | Add one node by type (returns its id). |
| `list_node_types` | Every graph node type with category + description. |
| `screenshot` | The current rendered output as a PNG. |

Between `set_param` (every continuous control), `run_action` (every
discrete command), and the graph tools (the whole patch), the entire
instrument is drivable remotely — and the surface grows automatically
as params/actions/nodes are added, because the tools read the app's own
registries rather than a parallel API.

## Notes

- The browser side answers from `src/io/McpRemote.ts`; writes go
  through the exact same code paths as the UI (base-value writes,
  action registry, `settings.set` + `engine.setPatch` for the graph).
- One browser connection at a time (latest wins). Calls time out after
  10 s if the tab is gone.
- Audio/CV output safety is unaffected: those stay structurally forced
  off on load and can only be armed by their own explicit in-app
  toggles (an MCP `set_param` can't reach non-numeric enable flags).
