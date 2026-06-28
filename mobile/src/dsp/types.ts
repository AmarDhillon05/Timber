// Effect chain specs. Each AudioFile/Blanket call appends one of these.
// Execution is deferred so the same chain can drive both a live preview
// graph and an offline export render without re-decoding the source.

export type Channels = Float32Array[]; // de-interleaved: one Float32Array per channel

// --- Native-node-backed primitives (rendered via OfflineAudioContext / live graph) ---

export type BiquadKind =
  | 'highpass'
  | 'lowpass'
  | 'bandpass'
  | 'notch'
  | 'peaking'
  | 'lowshelf'
  | 'highshelf';

export interface BiquadSpec {
  kind: BiquadKind;
  frequency: number; // Hz (center or cutoff)
  q?: number;
  gainDb?: number; // peaking / shelves only
}

export interface GainSpec {
  kind: 'gain';
  db: number;
}

export interface ReverbSpec {
  kind: 'reverb';
  roomSize: number; // 0..1
  damping: number; // 0..1
  wetLevel: number; // 0..1
  dryLevel: number; // 0..1
}

// --- Custom DSP (no native node — pure Float32Array, runs in a worklet on device) ---

export interface CompressorSpec {
  kind: 'compressor';
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
}

export interface GateSpec {
  kind: 'gate';
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
}

export interface UpwardCompressorSpec {
  kind: 'upwardCompressor';
  thresholdDb: number;
  ratio: number;
  maxGainDb: number; // cap on the makeup boost so silence isn't lifted
  attackMs: number;
  releaseMs: number;
}

export interface SaturationSpec {
  kind: 'saturation';
  drive: number; // y = tanh(x*drive) / drive
}

export interface PresenceSpec {
  kind: 'presence';
  lowHz: number;
  highHz: number;
  drive: number;
  blend: number;
}

export interface WidthSpec {
  kind: 'width';
  amount: number; // side gain: 1x at 0, 2x at 1
}

export interface SpectralGateSpec {
  kind: 'spectralGate';
  propDecrease: number; // 0..1
  stationary: boolean; // true = denoise, false = roominess
}

export interface ResonanceSpec {
  kind: 'resonance';
  amount: number; // notch Q = amount * 30
}

export type EffectSpec =
  | BiquadSpec
  | GainSpec
  | ReverbSpec
  | CompressorSpec
  | GateSpec
  | UpwardCompressorSpec
  | SaturationSpec
  | PresenceSpec
  | WidthSpec
  | SpectralGateSpec
  | ResonanceSpec;

const NATIVE_KINDS = new Set<EffectSpec['kind']>([
  'highpass',
  'lowpass',
  'bandpass',
  'notch',
  'peaking',
  'lowshelf',
  'highshelf',
  'gain',
  'reverb',
]);

export const isNativeSpec = (s: EffectSpec): boolean => NATIVE_KINDS.has(s.kind);
