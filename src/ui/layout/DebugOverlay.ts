/**
 * Corner overlay enabled with `?debug=layout`. Shows the live layout
 * decisions (mode, viewport, DPR, insets, FPS) so the testing matrix is
 * verifiable at a glance.
 */

import { LayoutManager } from './LayoutManager';

export class DebugOverlay {
  private el: HTMLDivElement;
  private mounted = false;
  private layout: LayoutManager;
  private fps = 0;
  private frameMs = 0;
  private renderScale = 1;
  private profile = '';
  private graphStats: { nodeCount: number; tickMs: number; cycleEdges: number } | null = null;

  constructor(layout: LayoutManager) {
    this.layout = layout;
    this.el = document.createElement('div');
    this.el.id = 'rw-debug';
    this.el.setAttribute('aria-hidden', 'true');
  }

  /** Attach to DOM only when the debug flag is set. */
  attachIfRequested(): void {
    if (!this.layout.isDebug && !this.layout.isDebugGraph) return;
    if (this.mounted) return;
    document.body.appendChild(this.el);
    this.mounted = true;
    this.layout.onModeChange(() => this.refresh());
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => this.refresh());
    }
    window.addEventListener('resize', () => this.refresh());
    this.refresh();
  }

  setStats(fps: number, frameMs: number): void {
    this.fps = fps;
    this.frameMs = frameMs;
    if (this.mounted) this.refresh();
  }

  setRenderQuality(renderScale: number, profileId: string): void {
    this.renderScale = renderScale;
    this.profile = profileId;
    if (this.mounted) this.refresh();
  }

  setGraphStats(stats: { nodeCount: number; tickMs: number; cycleEdges: number } | null): void {
    this.graphStats = stats;
    if (this.mounted) this.refresh();
  }

  private refresh(): void {
    const vp = this.layout.viewport();
    const insets = this.layout.safeAreaInsets();
    const dpr = window.devicePixelRatio.toFixed(2);
    const lines = [
      `mode      ${this.layout.current()}`,
      `viewport  ${vp.width}x${vp.height}`,
      `dpr       ${dpr}`,
      `insets    t${insets.top|0} r${insets.right|0} b${insets.bottom|0} l${insets.left|0}`,
      `orient    ${this.layout.orientation}  ${this.layout.hasTouch ? '[touch]' : '[mouse]'}`,
      `profile   ${this.profile}  scale ${this.renderScale.toFixed(2)}`,
      `fps       ${this.fps.toFixed(0)}  (${this.frameMs.toFixed(1)} ms)`,
    ];
    if (this.layout.isDebugGraph && this.graphStats) {
      const g = this.graphStats;
      lines.push(`graph     ${g.nodeCount} nodes · ${g.tickMs.toFixed(2)}ms · ${g.cycleEdges} cycle-edges`);
    }
    this.el.textContent = lines.join('\n');
  }
}
