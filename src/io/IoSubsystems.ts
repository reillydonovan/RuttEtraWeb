/**
 * Bootstraps the four I/O subsystems (MIDI clock, MIDI mapping/manager,
 * Audio FFT + beat detector, OSC client) and applies the persisted
 * settings eagerly so initial UI labels match.
 *
 * Everything here is in a separate file so `main.ts` can `import()` it
 * dynamically; it then ends up in its own chunk and stays out of the
 * critical render path on first paint.
 */

import { SettingsStore } from '../state/Settings';
import { MidiClock } from '../midi/MidiClock';
import { MidiMapping } from '../midi/MidiMapping';
import { MidiManager } from '../midi/MidiManager';
import { MidiClockOut } from '../midi/MidiClockOut';
import { FFTAnalyzer } from '../audio/FFTAnalyzer';
import { BeatDetector } from '../audio/BeatDetector';
import { OscClient } from '../osc/OscClient';
import { CVInput } from '../audio/CVInput';
import { CVOutput } from '../audio/CVOutput';
import { GamepadInput } from '../input/GamepadInput';
import { LiveValuesStore } from '../modulation/LiveValues';

export interface IoSubsystems {
  midiClock:   MidiClock;
  midiMapping: MidiMapping;
  midiManager: MidiManager;
  midiClockOut: MidiClockOut;
  fft:         FFTAnalyzer;
  beat:        BeatDetector;
  osc:         OscClient;
  cv:          CVInput;
  cvOut:       CVOutput;
  gamepad:     GamepadInput;
}

export async function bootIoSubsystems(settings: SettingsStore, live: LiveValuesStore): Promise<IoSubsystems> {
  const midiClock = new MidiClock();
  const midiMapping = new MidiMapping(settings);
  const midiManager = new MidiManager(settings, midiClock, midiMapping);

  // v22: MIDI clock transmitter driven by the shared internalBpm.
  // Forced-off on every load by migrateSettings; the toggle in
  // I/O -> MIDI arms it per session.
  const midiClockOut = new MidiClockOut(
    () => midiManager.getOutput(),
    () => settings.get('internalBpm'),
  );
  settings.subscribe('midiClockOutEnabled', (on) => {
    if (on) midiClockOut.start(); else midiClockOut.stop();
  });

  const fft = new FFTAnalyzer();
  const beat = new BeatDetector(fft);
  fft.setFftSize(settings.get('audioFftSize'));
  fft.setBandCount(settings.get('audioBandCount'));
  fft.setSpacing(settings.get('audioBandSpacing'));
  // Band shape is modulatable (LFO/CV/timeline-keyframed) — read live so
  // an engine contribution or a base-slider drag both take effect, not
  // just the value present at boot (was `settings.get`, a one-shot read
  // with no subscription at all: post-boot slider drags on these five
  // params previously had NO effect on the running analyzer).
  const applyBandShape = (): void => {
    fft.setBandShape({
      attackMs:    live.getLive('audioAttackMs'),
      releaseMs:   live.getLive('audioReleaseMs'),
      gain:        live.getLive('audioGain'),
      floor:       live.getLive('audioFloor'),
      thresholdDb: live.getLive('audioThresholdDb'),
    });
  };
  applyBandShape();
  for (const k of ['audioAttackMs', 'audioReleaseMs', 'audioGain', 'audioFloor', 'audioThresholdDb'] as const) {
    live.subscribe(k, applyBandShape);
  }
  beat.setEnabled(settings.get('beatEnabled'));
  live.subscribe('beatSensitivity', (v) => beat.setSensitivity(v));

  const osc = new OscClient(settings);

  // CV reader for DC-coupled audio interfaces. NOT auto-started — Web
  // Audio's `getUserMedia` requires a user gesture in Chrome, so the
  // user picks an interface in the I/O panel and `start()`s it from
  // there. We pre-load the persisted per-channel config so the moment
  // they hit start, calibration / range / smoothing match what they
  // had last session.
  const cv = new CVInput();
  cv.setChannelConfigs(settings.get('cvChannels'));
  settings.subscribe('cvChannels', (v) => cv.setChannelConfigs(v));

  // Gamepad poller. Fully passive until something calls `poll()` from
  // the render loop (see main.ts).
  const gamepad = new GamepadInput(settings);

  // CV writer. Like CVInput, NOT auto-started — the user picks the
  // DC-coupled output interface and clicks Start in the I/O panel,
  // which counts as the gesture Chrome requires for AudioContext.
  // Per the v9 spec the master enable + every channel's `enabled`
  // flag are forced to false during settings migration on every page
  // load, so even after a successful start no voltage leaves the
  // interface until the user re-arms each channel.
  const cvOut = new CVOutput(settings, live);
  cvOut.setMidiNoteProvider(() => {
    // Pull "the most-recently-played note across MIDI channel 1" — the
    // channel CV-out users will hit by default. They can configure
    // a different MIDI channel per pitch CV via the channel's params.
    const poly = midiMapping.getPoly(1);
    if (poly.lastNote == null) return null;
    return { note: poly.lastNote, velocity: poly.lastVelocity };
  });

  return { midiClock, midiMapping, midiManager, midiClockOut, fft, beat, osc, cv, cvOut, gamepad };
}
