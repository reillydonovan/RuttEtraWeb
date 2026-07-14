/**
 * MCP section UI (I/O tab) — connection controls for the MCP
 * remote-control bridge. Mirrors the OSC section's Bridge group:
 * URL input, status dot, connect/disconnect, auto-connect toggle,
 * pointer to the bridge's README.
 *
 * The command surface itself lives in `src/io/McpRemote.ts`; this is
 * just the opt-in switch. Nothing connects until the user says so.
 */

import { SettingsStore } from '../../state/Settings';
import { McpRemote } from '../../io/McpRemote';
import { row, group, button, textInput, toggle } from '../widgets';

export function createMcpSection(settings: SettingsStore, mcp: McpRemote): HTMLElement {
  const root = document.createElement('div');

  const connGroup = group('MCP Bridge');

  const blurb = document.createElement('div');
  blurb.className = 'rw-hint';
  blurb.textContent =
    'Remote-control the whole synth from an MCP-speaking agent (Claude '
    + 'Desktop, Claude Code, etc.): every modulatable param, every menu '
    + 'command, the graph patch, and screenshots. Run the bridge from '
    + 'tools/mcp-server/ and connect.';
  connGroup.body.appendChild(blurb);

  const urlInp = textInput(settings.get('mcpBridgeUrl'), 'ws://localhost:57132');
  urlInp.addEventListener('change', () => settings.set('mcpBridgeUrl', urlInp.value));
  connGroup.body.appendChild(row('URL', urlInp));

  const statusRow = document.createElement('div');
  statusRow.className = 'rw-status';
  const dot = document.createElement('span');
  dot.className = 'rw-status-dot';
  const txt = document.createElement('span');
  txt.textContent = 'idle';
  statusRow.append(dot, txt);
  connGroup.body.appendChild(statusRow);

  mcp.subscribe((s) => {
    txt.textContent = s;
    dot.classList.toggle('on',   s === 'connected');
    dot.classList.toggle('warn', s === 'connecting');
    dot.classList.toggle('err',  s === 'error');
  });

  const btnRow = document.createElement('div');
  btnRow.className = 'rw-btn-row';
  btnRow.appendChild(button('Connect',    () => mcp.connect(), 'primary'));
  btnRow.appendChild(button('Disconnect', () => mcp.disconnect()));
  connGroup.body.appendChild(btnRow);

  connGroup.body.appendChild(row('Auto-connect on startup', toggle(settings, 'mcpAutoConnect', '')));

  const readme = document.createElement('div');
  readme.className = 'rw-hint';
  readme.innerHTML = 'Run the bridge with <code>npm start</code> inside <code>tools/mcp-server/</code>, then point your MCP client at it. See its README for the tool list.';
  connGroup.body.appendChild(readme);

  root.appendChild(connGroup.root);
  return root;
}
