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
import { FFTAnalyzer } from '../audio/FFTAnalyzer';
import { BeatDetector } from '../audio/BeatDetector';
import { OscClient } from '../osc/OscClient';

export interface IoSubsystems {
  midiClock:   MidiClock;
  midiMapping: MidiMapping;
  midiManager: MidiManager;
  fft:         FFTAnalyzer;
  beat:        BeatDetector;
  osc:         OscClient;
}

export async function bootIoSubsystems(settings: SettingsStore): Promise<IoSubsystems> {
  const midiClock = new MidiClock();
  const midiMapping = new MidiMapping(settings);
  const midiManager = new MidiManager(settings, midiClock, midiMapping);

  const fft = new FFTAnalyzer();
  const beat = new BeatDetector(fft);
  fft.setFftSize(settings.get('audioFftSize'));
  fft.setBandCount(settings.get('audioBandCount'));
  fft.setSpacing(settings.get('audioBandSpacing'));
  fft.setBandShape({
    attackMs:    settings.get('audioAttackMs'),
    releaseMs:   settings.get('audioReleaseMs'),
    gain:        settings.get('audioGain'),
    floor:       settings.get('audioFloor'),
    thresholdDb: settings.get('audioThresholdDb'),
  });
  beat.setEnabled(settings.get('beatEnabled'));
  beat.setSensitivity(settings.get('beatSensitivity'));

  const osc = new OscClient(settings);

  return { midiClock, midiMapping, midiManager, fft, beat, osc };
}
