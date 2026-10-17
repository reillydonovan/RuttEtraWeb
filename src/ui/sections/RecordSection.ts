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
import { RESOLUTION_PRESETS } from '../../renderer/ResolutionManager';
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

  // Authoritative recording dimensions = the main canvas's actual
  // drawing buffer size. This is what captureStream() and the stereo
  // compositor both read, so using it as the single source of truth
  // keeps mono and stereo consistent even when renderScale ≠ 1.
  //
  // Why not use the preset's logical dimensions?  Because
  // ResolutionManager sets canvas.width = presetWidth × renderScale.
  // The preset says "4K" but if renderScale=0.75, the canvas (and thus
  // the recording) is 2880×1620.  Reading canvas.width is always honest.
  function getCanvasSize(): { w: number; h: number } {
    const cv = document.getElementById('stage') as HTMLCanvasElement | null
      ?? document.querySelector('canvas');
    return { w: cv?.width ?? 1280, h: cv?.height ?? 720 };
  }

  // Alias used for the stereo compositor eye dimensions — per-eye is
  // half the composite width. The caller passes this to
  // StereoCompositor.start(), which sets its own canvas to 2×eyeW.
  function getEyeResolution(): { w: number; h: number } {
    return getCanvasSize();
  }

  const cfg = group('Configuration');

  // Resolution readout — tells the user exactly what pixel dimensions
  // they will record, and why. Line 1: the actual canvas drawing-buffer
  // size (what captureStream reads — no computation from settings).
  // Line 2: the two settings that produced those dimensions, so the user
  // knows which control to change if the number isn't what they wanted.
  //
  // This surfaces the source-vs-render terminology collision: the Source
  // section's "Resolution" picker controls webcam capture quality
  // (requestedWidth/Height), not render output size.
  const resReadout = readout();
  resReadout.style.cssText = 'font-size:11px; opacity:0.75; margin-bottom:4px;';
  function refreshResReadout(): void {
    const { w, h } = getCanvasSize();
    const id = settings.get('renderResolutionId');
    const presetLabel = RESOLUTION_PRESETS.find((p) => p.id === id)?.label ?? id;
    const scale = settings.get('renderScale');
    resReadout.innerHTML =
      `Recording at: <b>${w} × ${h}</b><br>` +
      `<span style="opacity:0.8">(Render resolution: ${presetLabel} · Render scale ${scale.toFixed(2)}) — change in <b>Camera → Resolution</b></span>`;
  }
  refreshResReadout();
  // Refresh whenever any setting that affects canvas dimensions changes.
  settings.subscribe('renderResolutionId',      refreshResReadout);
  settings.subscribe('renderScale',             refreshResReadout);
  settings.subscribe('renderResolutionCustomW', refreshResReadout);
  settings.subscribe('renderResolutionCustomH', refreshResReadout);
  // Also refresh after the browser has had a chance to resize the canvas
  // (e.g. on window resize — the canvas changes 120ms later via scheduleResize).
  window.addEventListener('resize', () => setTimeout(refreshResReadout, 150));

  // Quality note — shown because thin wire-art is the hardest case
  // for block-DCT codecs and users frequently under-set bitrate.
  const qualityNote = document.createElement('p');
  qualityNote.className = 'section-note';
  qualityNote.innerHTML =
    'Thin scan lines are the hardest picture for a video codec. The <b>High quality</b> '
    + 'encoder records at a locked size and frame rate with <b>constant quality</b>, which '
    + 'spends bits where the lines are. For the sharpest lines, set a fixed size in '
    + '<b>Virtual Camera → Resolution</b> (e.g. 1080p) rather than Match Window. '
    + 'Choose <b>Bitrate</b> rate control if you need a predictable file size (40 Mbps+ for 1080p, '
    + '80–150 for 4K). <b>Compatibility</b> uses the browser’s realtime recorder.';

  cfg.body.append(
    resReadout,
    qualityNote,
    row('Format', dropdown(settings, 'recordPreferredFormat', [
      { value: 'auto',     label: 'Auto (best available)' },
      { value: 'mp4',      label: 'MP4 / H.264' },
      { value: 'webm-vp9', label: 'WebM / VP9' },
      { value: 'webm-vp8', label: 'WebM / VP8' },
    ])),
    row('Encoder', dropdown(settings, 'recordEncoder', [
      { value: 'webcodecs',     label: 'High quality (WebCodecs)' },
      { value: 'mediarecorder', label: 'Compatibility (MediaRecorder)' },
    ])),
    row('Rate Control', dropdown(settings, 'recordRateControl', [
      { value: 'quality', label: 'Constant quality (best for line art)' },
      { value: 'bitrate', label: 'Bitrate (predictable file size)' },
    ])),
    row('FPS',     slider(settings, 'recordFps',          15, 120, 1)),
    row('Bitrate', slider(settings, 'recordBitrateMbps',   1, 200, 1), 'Mbps — target for Bitrate mode and Compatibility'),
    row('Include Mic', toggle(settings, 'recordIncludeMic')),
    row('Include Video Audio', toggle(settings, 'recordIncludeVideoAudio')),
  );
  root.appendChild(cfg.root);

  const status = readout();
  const IDLE_TEXT = 'no recording active';
  status.textContent = IDLE_TEXT;
  const startBtn = button('Start Recording', async () => {
    try {
      const stereoEnabled = settings.get('stereoRecordingEnabled');
      if (stereoEnabled && !stereoCompositor) {
        throw new Error('Stereo compositor not wired in this context');
      }
      const eye = getEyeResolution();
      await recorder.start({
        fps:               settings.get('recordFps'),
        bitsPerSecond:     settings.get('recordBitrateMbps') * 1_000_000,
        includeMic:        settings.get('recordIncludeMic'),
        includeVideoAudio: settings.get('recordIncludeVideoAudio'),
        preferredFormat:   settings.get('recordPreferredFormat'),
        engine:   settings.get('recordEncoder'),
        rateControl: settings.get('recordRateControl'),
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

  // Status line follows the recorder: timer while recording, "saving…" while the file is
  // finalized, then back to idle (the saved-file toast reports the result).
  let wasActive = false;
  recorder.subscribe((s) => {
    if (s === 'finalizing') status.textContent = 'saving recording…';
    else if (s === 'idle' && wasActive) {
      const eng = recorder.engineSummary();
      status.textContent = eng.startsWith('save failed') ? eng : IDLE_TEXT;
    }
    wasActive = s !== 'idle';
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
      const eng = recorder.engineSummary();
      status.innerHTML = `<span class="rw-rec-dot"></span>recording ${m}:${sec.padStart(4, '0')}`
        + (eng ? `<br><span style="opacity:0.7">${eng.replace(/[<>&]/g, '')}</span>` : '');
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
          fps:               settings.get('recordFps'),
          bitsPerSecond:     settings.get('recordBitrateMbps') * 1_000_000,
          includeMic:        settings.get('recordIncludeMic'),
          includeVideoAudio: settings.get('recordIncludeVideoAudio'),
          preferredFormat:   settings.get('recordPreferredFormat'),
          engine:   settings.get('recordEncoder'),
          rateControl: settings.get('recordRateControl'),
          filenameHint:      t.name,
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
      // getEyeResolution() now reads canvas.width/height directly, so
      // this readout stays in sync with the mono resolution readout
      // above and reflects renderScale correctly.
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
    settings.subscribe('renderResolutionId',      refreshDims);
    settings.subscribe('renderScale',             refreshDims);
    settings.subscribe('renderResolutionCustomW', refreshDims);
    settings.subscribe('renderResolutionCustomH', refreshDims);
    window.addEventListener('resize', () => setTimeout(refreshDims, 150));

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
