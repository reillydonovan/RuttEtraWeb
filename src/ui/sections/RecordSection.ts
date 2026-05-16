/**
 * Record section — start/stop, format choice, optional mic, elapsed timer.
 *
 * Also exposes a "Record Timeline" button that drives the Sequencer through
 * a one-shot pass and saves the result with a filename derived from the
 * timeline name.
 */

import { SettingsStore } from '../../state/Settings';
import { CanvasRecorder } from '../../record/Recorder';
import { Sequencer } from '../../sequencer/Sequencer';
import { StereoCompositor } from '../../record/StereoCompositor';
import { row, group, slider, toggle, dropdown, button, readout } from '../widgets';

/**
 * Optional hook for the 3-second preview. main.ts owns the render-loop
 * branch that swaps `postfx.render` for `compositor.renderPreviewTo`;
 * the section just toggles a boolean here and the loop reads it.
 */
export interface StereoPreviewHook {
  isActive(): boolean;
  start(durationMs: number): void;
}

/**
 * Toast hook for stereo recording outcomes. main.ts passes a thunk
 * that hits the existing `projectToast` surface so we don't need a
 * second toast plumbing inside Record.
 */
export interface RecordToastHook {
  show(message: string): void;
}

export interface RecordSectionDeps {
  recorder: CanvasRecorder;
  sequencer?: Sequencer;
  stereoCompositor?: StereoCompositor;
  stereoPreview?: StereoPreviewHook;
  toast?: RecordToastHook;
}

export function createRecordSection(
  settings: SettingsStore,
  depsOrRecorder: RecordSectionDeps | CanvasRecorder,
  legacySequencer?: Sequencer,
): HTMLElement {
  // Back-compat shape: existing callers pass (settings, recorder, sequencer);
  // the new shape passes (settings, deps).
  const deps: RecordSectionDeps = depsOrRecorder instanceof CanvasRecorder
    ? { recorder: depsOrRecorder, sequencer: legacySequencer }
    : depsOrRecorder;
  const recorder = deps.recorder;
  const sequencer = deps.sequencer;
  const stereoCompositor = deps.stereoCompositor ?? null;
  const stereoPreview = deps.stereoPreview ?? null;
  const toast = deps.toast ?? null;

  const root = document.createElement('div');

  const cfg = group('Configuration');
  cfg.body.append(
    row('Format', dropdown(settings, 'recordPreferredFormat', [
      { value: 'auto',     label: 'Auto (best available)' },
      { value: 'mp4',      label: 'MP4 / H.264' },
      { value: 'webm-vp9', label: 'WebM / VP9' },
      { value: 'webm-vp8', label: 'WebM / VP8' },
    ])),
    row('FPS',     slider(settings, 'recordFps',         15, 120, 1)),
    row('Bitrate', slider(settings, 'recordBitrateMbps', 1,  40,  0.5)),
    row('Include Mic', toggle(settings, 'recordIncludeMic')),
  );
  root.appendChild(cfg.root);

  // Helper to read the configured per-eye recording resolution. Falls
  // back to the visible canvas size when "Match Window" is selected.
  function getEyeResolution(): { w: number; h: number } {
    const id = settings.get('renderResolutionId');
    // RESOLUTION_PRESETS lives in ResolutionManager; we hard-code the
    // common cases here to avoid a circular import. The Custom and
    // Match Window cases fall back to the canvas's actual pixel size.
    const presets: Record<string, [number, number]> = {
      sd:    [854, 480],
      hd:    [1280, 720],
      fhd:   [1920, 1080],
      qhd:   [2560, 1440],
      uhd:   [3840, 2160],
      dci4k: [4096, 2160],
    };
    const preset = presets[id];
    if (preset) return { w: preset[0], h: preset[1] };
    if (id === 'custom') {
      return {
        w: settings.get('renderResolutionCustomW'),
        h: settings.get('renderResolutionCustomH'),
      };
    }
    const cv = document.querySelector('canvas');
    return { w: cv?.width ?? 1280, h: cv?.height ?? 720 };
  }

  const status = readout();
  const startBtn = button('Start Recording', async () => {
    try {
      const stereoEnabled = settings.get('stereoRecordingEnabled');
      if (stereoEnabled && !stereoCompositor) {
        throw new Error('Stereo compositor not wired in this context');
      }
      const eye = getEyeResolution();
      await recorder.start({
        fps:             settings.get('recordFps'),
        bitsPerSecond:   settings.get('recordBitrateMbps') * 1_000_000,
        includeMic:      settings.get('recordIncludeMic'),
        preferredFormat: settings.get('recordPreferredFormat'),
        ...(stereoEnabled && stereoCompositor ? {
          stereo: {
            enabled: true,
            source: stereoCompositor,
            eyeWidth:  eye.w,
            eyeHeight: eye.h,
            injectMetadata: settings.get('stereoInjectMetadata'),
          },
        } : {}),
      });
    } catch (err) {
      status.textContent = `Error: ${(err as Error).message}`;
    }
  }, 'primary');
  const stopBtn = button('Stop & Download', () => recorder.stop(), 'danger');
  stopBtn.setAttribute('disabled', 'true');

  const btns = document.createElement('div');
  btns.className = 'rw-btn-row';
  btns.append(startBtn, stopBtn);
  root.appendChild(btns);
  root.appendChild(status);

  recorder.subscribe((s) => {
    if (s === 'recording') {
      startBtn.setAttribute('disabled', 'true');
      stopBtn.removeAttribute('disabled');
    } else {
      stopBtn.setAttribute('disabled', 'true');
      startBtn.removeAttribute('disabled');
    }
  });

  // Live timer
  function tick() {
    if (recorder.isRecording()) {
      const ms = recorder.elapsedMs();
      const s = ms / 1000;
      const m = Math.floor(s / 60);
      const sec = (s - m * 60).toFixed(1);
      status.innerHTML = `<span class="rw-rec-dot"></span>recording ${m}:${sec.padStart(4, '0')}`;
    }
    requestAnimationFrame(tick);
  }
  tick();

  // -------- Record Timeline -------------------------------------------------
  if (sequencer) {
    const tg = group('Record Timeline');
    const timelineStatus = readout();
    timelineStatus.textContent = 'no timeline loaded';

    let savedLoop: boolean | null = null;
    let armed = false; // true while a timeline-record run is in flight.

    const recordTlBtn = button('Record Timeline', async () => {
      const t = sequencer.timeline;
      if (!t) {
        timelineStatus.textContent = 'no timeline loaded';
        return;
      }
      if (t.keyframes.length < 2) {
        timelineStatus.textContent = 'need at least 2 keyframes';
        return;
      }
      try {
        sequencer.seek(0);
        savedLoop = t.loop;
        sequencer.setLoopOverride(false);
        await recorder.start({
          fps:             settings.get('recordFps'),
          bitsPerSecond:   settings.get('recordBitrateMbps') * 1_000_000,
          includeMic:      settings.get('recordIncludeMic'),
          preferredFormat: settings.get('recordPreferredFormat'),
          filenameHint:    t.name,
        });
        armed = true;
        sequencer.play();
        timelineStatus.textContent = `recording timeline "${t.name}"...`;
      } catch (err) {
        timelineStatus.textContent = `Error: ${(err as Error).message}`;
        sequencer.setLoopOverride(null);
      }
    }, 'primary');

    tg.body.append(recordTlBtn, timelineStatus);
    root.appendChild(tg.root);

    // When the sequencer reaches end (clamp + pause), auto-stop the recorder.
    const prevHandler = sequencer.onPlayStateChange;
    sequencer.onPlayStateChange = (playing: boolean) => {
      prevHandler?.(playing);
      if (armed && !playing) {
        armed = false;
        sequencer.setLoopOverride(null);
        // Restore loop preference (it wasn't mutated, but be tidy).
        savedLoop = null;
        recorder.stop();
        timelineStatus.textContent = 'finalizing...';
        // Brief delay before clearing.
        setTimeout(() => { timelineStatus.textContent = 'done'; }, 1500);
      }
    };

    const refreshButton = () => {
      const t = sequencer.timeline;
      const ok = !!t && t.keyframes.length >= 2;
      recordTlBtn.toggleAttribute('disabled', !ok || recorder.isRecording());
      if (!t) timelineStatus.textContent = 'no timeline loaded';
      else if (t.keyframes.length < 2) timelineStatus.textContent = 'need at least 2 keyframes';
    };
    const prevTimelineHandler = sequencer.onTimelineChange;
    sequencer.onTimelineChange = (t) => {
      prevTimelineHandler?.(t);
      refreshButton();
    };
    refreshButton();
  }

  // -------- Stereoscopic 3D ------------------------------------------------
  if (stereoCompositor) {
    const sg = group('Stereoscopic 3D');

    // Top-level toggle. The detail rows show / hide based on this so
    // the user isn't faced with sliders that do nothing when stereo
    // is off (Principle 7: match the user's mental model).
    const enableRow = row('Enable stereoscopic recording', toggle(settings, 'stereoRecordingEnabled'));
    sg.body.append(enableRow);

    const details = document.createElement('div');
    sg.body.append(details);

    const ipdRow = row('IPD (cm)', slider(settings, 'stereoIpdCm', 1.0, 15.0, 0.1));
    const metaRow = row('Inject YouTube 3D metadata', toggle(settings, 'stereoInjectMetadata'));
    details.append(ipdRow, metaRow);

    // Output-dimensions readout updates whenever the source resolution
    // setting changes — gives the user a concrete number for what
    // file they'll get. The 4K warning attaches to the same readout.
    const dimsLine = readout();
    const fourKWarn = document.createElement('div');
    fourKWarn.className = 'rw-warn';
    fourKWarn.style.cssText = 'font-size:11px; opacity:0.85; margin-top:4px;';
    details.append(dimsLine, fourKWarn);

    function refreshDims(): void {
      const eye = getEyeResolution();
      const compositeW = eye.w * 2;
      dimsLine.textContent = `Output: ${compositeW}×${eye.h} side-by-side (eye: ${eye.w}×${eye.h})`;
      if (compositeW >= 7680) {
        fourKWarn.textContent =
          'Heads-up: a 4K stereo file is ' + compositeW + 'px wide — many browsers ' +
          'will refuse to encode at that size. If recording fails, drop to QHD or below.';
      } else {
        fourKWarn.textContent = '';
      }
    }
    refreshDims();
    settings.subscribe('renderResolutionId', refreshDims);
    settings.subscribe('renderResolutionCustomW', refreshDims);
    settings.subscribe('renderResolutionCustomH', refreshDims);

    // Preview button. Asks main.ts to swap stereo-preview rendering
    // in for 3 seconds. The button stays disabled while a preview or
    // recording is already in flight to avoid stacked previews.
    const previewBtn = button('Preview stereo (3 s)', () => {
      if (!stereoPreview) return;
      if (stereoPreview.isActive()) return;
      stereoPreview.start(3000);
    });
    if (!stereoPreview) {
      previewBtn.setAttribute('disabled', 'true');
      previewBtn.title = 'Preview hook not wired';
    }
    const previewBtns = document.createElement('div');
    previewBtns.className = 'rw-btn-row';
    previewBtns.append(previewBtn);
    details.append(previewBtns);

    // Note about postfx, displayed when stereo is on.
    const postfxNote = document.createElement('div');
    postfxNote.className = 'rw-note';
    postfxNote.style.cssText = 'font-size:11px; opacity:0.75; margin-top:6px;';
    postfxNote.textContent =
      'Note: postfx (bloom, CRT, feedback) is not applied to stereoscopic output in v1. ' +
      'The mesh renders raw — its own aesthetic, same as XR.';
    details.append(postfxNote);

    function refreshDetailsVisibility(): void {
      const on = settings.get('stereoRecordingEnabled');
      details.style.display = on ? '' : 'none';
    }
    refreshDetailsVisibility();
    settings.subscribe('stereoRecordingEnabled', refreshDetailsVisibility);

    root.appendChild(sg.root);

    // Per-recording outcome toast. Fires once per Stop & Download with
    // the result of metadata injection — a successful inject is silent
    // (no toast needed; the file is just ready), but skipped (WebM) /
    // failed are surfaced with the actionable YouTube Studio pointer.
    if (toast) {
      recorder.subscribeOutcome((outcome) => {
        if (!outcome) return; // monoscopic recording — nothing to say
        if (outcome.kind === 'injected') return;
        if (outcome.kind === 'skipped') {
          toast.show(
            "Recorded as WebM side-by-side stereo. YouTube won't auto-detect this as 3D — " +
            "when you upload, mark it as 3D in YouTube Studio's video settings (Editor → 3D).",
          );
        } else if (outcome.kind === 'failed') {
          toast.show(
            'Recorded successfully, but stereoscopic metadata injection failed: ' +
            outcome.reason + '. The file is still valid side-by-side stereo — flag it as 3D in YouTube Studio manually.',
          );
        }
      });
    }
  }

  // List supported codecs at the bottom for transparency
  const supported = CanvasRecorder.availableFormats();
  const list = readout();
  list.style.marginTop = '6px';
  list.textContent = `supported codecs:\n${supported.map((f) => '  • ' + f.mime).join('\n') || '  none'}`;
  root.appendChild(list);

  return root;
}
