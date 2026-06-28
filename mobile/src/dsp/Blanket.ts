// Port of functions/blanket.py. High-level perceptual controls; each takes
// amount: 0..1 and maps it onto the AudioFile primitives / custom specs with
// the exact same ranges as the Python.

import type { AudioFile } from './AudioFile';

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export class Blanket {
  constructor(private a: AudioFile) {}

  // --- EQ / Frequency ---

  high_pass_rumble(amount = 1.0): AudioFile {
    const cutoffHz = 40 + amount * 40; // 40 → 80 Hz
    return this.a.high_pass(cutoffHz);
  }

  denoise(amount = 1.0): AudioFile {
    return this.a.add({ kind: 'spectralGate', propDecrease: clamp01(amount), stationary: true });
  }

  kick_presence(amount = 1.0): AudioFile {
    return this.a.peak_eq(90, amount * 3.0, 1.2);
  }

  snare_body(amount = 1.0): AudioFile {
    return this.a.peak_eq(200, amount * 2.5, 1.5);
  }

  boxiness(amount = 1.0): AudioFile {
    return this.a.peak_eq(350, -amount * 3.0, 0.8);
  }

  attack(amount = 1.0): AudioFile {
    return this.a.peak_eq(4000, amount * 3.0, 1.0);
  }

  harshness(amount = 1.0): AudioFile {
    return this.a.peak_eq(6000, -amount * 2.5, 1.0);
  }

  air(amount = 1.0): AudioFile {
    return this.a.high_shelf(10000, amount * 3.0);
  }

  brightness(amount = 1.0): AudioFile {
    return this.a.high_shelf(8000, amount * 2.0);
  }

  resonance(amount = 1.0): AudioFile {
    return this.a.add({ kind: 'resonance', amount });
  }

  // --- Dynamics ---

  dynamic_range(amount = 1.0): AudioFile {
    return this.a.add({
      kind: 'compressor',
      thresholdDb: -18,
      ratio: 1.0 + amount * 3.0,
      attackMs: 10,
      releaseMs: 100,
    });
  }

  punch(amount = 1.0): AudioFile {
    return this.a.add({
      kind: 'compressor',
      thresholdDb: -20,
      ratio: 1.0 + amount * 2.0,
      attackMs: amount * 30.0,
      releaseMs: 80,
    });
  }

  sustain(amount = 1.0): AudioFile {
    return this.a.add({
      kind: 'gate',
      thresholdDb: -40,
      ratio: 1.0 + amount * 2.0,
      attackMs: 1.0,
      releaseMs: 100,
    });
  }

  // Upward compression: lifts low-level detail (ghost notes, room, fingering)
  // toward the threshold without touching the loud hits.
  detail(amount = 1.0): AudioFile {
    return this.a.add({
      kind: 'upwardCompressor',
      thresholdDb: -30,
      ratio: 1.0 + amount,
      maxGainDb: amount * 4.0,
      attackMs: 5,
      releaseMs: 150,
    });
  }

  consistency(amount = 1.0): AudioFile {
    return this.a.add({
      kind: 'compressor',
      thresholdDb: -12,
      ratio: 1.0 + amount * 1.0,
      attackMs: 5,
      releaseMs: 50,
    });
  }

  pumping(amount = 1.0): AudioFile {
    return this.a.add({
      kind: 'compressor',
      thresholdDb: -18,
      ratio: 1.0 + amount * 1.0,
      attackMs: 10,
      releaseMs: 100 + amount * 400,
    });
  }

  // --- Room / Spatial ---

  roominess(amount = 1.0): AudioFile {
    return this.a.add({ kind: 'spectralGate', propDecrease: clamp01(amount), stationary: false });
  }

  width(amount = 1.0): AudioFile {
    return this.a.add({ kind: 'width', amount });
  }

  depth(amount = 1.0): AudioFile {
    return this.a.add({
      kind: 'reverb',
      roomSize: clamp01(amount * 0.3),
      damping: 0.7,
      wetLevel: clamp01(amount * 0.15),
      dryLevel: 1.0,
    });
  }

  // --- Artifacts ---

  clipping(amount = 1.0): AudioFile {
    return this.a.add({ kind: 'saturation', drive: 1.0 + amount });
  }

  // --- Harmonic ---

  warmth(amount = 1.0): AudioFile {
    return this.a.add({ kind: 'saturation', drive: 1.0 + amount * 2.0 });
  }

  presence(amount = 1.0): AudioFile {
    return this.a.add({
      kind: 'presence',
      lowHz: 2000,
      highHz: 8000,
      drive: 1.0 + amount,
      blend: amount * 0.3,
    });
  }

  fullness(amount = 1.0): AudioFile {
    this.a.peak_eq(200, amount * 1.5, 1.5);
    return this.a.add({ kind: 'saturation', drive: 1.0 + amount * 0.5 });
  }

  // --- Perceptual ---

  naturalness(amount = 1.0): AudioFile {
    return this.a.add({
      kind: 'compressor',
      thresholdDb: -3,
      ratio: 1.0 + amount * 19.0,
      attackMs: 0.1,
      releaseMs: 50,
    });
  }
}
