// Pure Float32Array DSP for the effects react-native-audio-api has no node for.
// Each mutates `channels` in place and returns it, mirroring the Python which
// mutates AudioFile.data. These functions are engine-agnostic: today they run
// in the offline render path; the same code drops into an audio-thread worklet
// for live preview.

import { Channels } from './types';
import { bandpass, filtfilt } from './biquad';
import { fft, nextPow2 } from './fft';

const EPS = 1e-12;
const dbToLin = (db: number) => Math.pow(10, db / 20);

// --- Dynamics: feedforward compressor (replaces pedalboard.Compressor) ---
// Stereo-linked detector; gain reduction tracked in dB with attack/release.
export function compress(
  channels: Channels,
  sr: number,
  p: { thresholdDb: number; ratio: number; attackMs: number; releaseMs: number },
): Channels {
  const n = channels[0].length;
  const attCoeff = Math.exp(-1 / (sr * (p.attackMs / 1000) + EPS));
  const relCoeff = Math.exp(-1 / (sr * (p.releaseMs / 1000) + EPS));
  const slope = 1 - 1 / p.ratio;
  let gr = 0; // current gain reduction, dB (>= 0)

  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (let c = 0; c < channels.length; c++) {
      const a = Math.abs(channels[c][i]);
      if (a > peak) peak = a;
    }
    const levelDb = 20 * Math.log10(peak + EPS);
    const over = levelDb - p.thresholdDb;
    const target = over > 0 ? over * slope : 0;
    const coeff = target > gr ? attCoeff : relCoeff;
    gr = target + (gr - target) * coeff;
    const g = dbToLin(-gr);
    for (let c = 0; c < channels.length; c++) channels[c][i] *= g;
  }
  return channels;
}

// --- Dynamics: upward compressor (lifts low-level detail / ghost notes) ---
// Boosts signal that sits BELOW the threshold, bringing quiet detail up toward
// it; signal above the threshold is left alone. The makeup gain is capped at
// maxGainDb so the noise floor / silence isn't lifted without bound.
export function upwardCompress(
  channels: Channels,
  sr: number,
  p: { thresholdDb: number; ratio: number; maxGainDb: number; attackMs: number; releaseMs: number },
): Channels {
  const n = channels[0].length;
  const attCoeff = Math.exp(-1 / (sr * (p.attackMs / 1000) + EPS));
  const relCoeff = Math.exp(-1 / (sr * (p.releaseMs / 1000) + EPS));
  const slope = 1 - 1 / p.ratio;
  let env = 0; // linear peak envelope (sustained level, not instantaneous)
  let gain = 0; // current makeup gain, dB (>= 0)

  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (let c = 0; c < channels.length; c++) {
      const a = Math.abs(channels[c][i]);
      if (a > peak) peak = a;
    }
    // Peak follower: instant attack, slow release. Holds through a waveform's
    // zero-crossings so a loud tone isn't mistaken for quiet at its troughs.
    env = peak > env ? peak : peak + (env - peak) * relCoeff;
    const levelDb = 20 * Math.log10(env + EPS);
    const under = p.thresholdDb - levelDb;
    let target = under > 0 ? under * slope : 0;
    if (target > p.maxGainDb) target = p.maxGainDb;
    // boost faster (attack) as it rises, recover slower (release) as it falls
    const coeff = target > gain ? attCoeff : relCoeff;
    gain = target + (gain - target) * coeff;
    const g = dbToLin(gain);
    for (let c = 0; c < channels.length; c++) channels[c][i] *= g;
  }
  return channels;
}

// --- Dynamics: noise gate / downward expander (replaces pedalboard.NoiseGate) ---
export function gate(
  channels: Channels,
  sr: number,
  p: { thresholdDb: number; ratio: number; attackMs: number; releaseMs: number },
): Channels {
  const n = channels[0].length;
  const attCoeff = Math.exp(-1 / (sr * (p.attackMs / 1000) + EPS));
  const relCoeff = Math.exp(-1 / (sr * (p.releaseMs / 1000) + EPS));
  let att = 0; // current attenuation, dB (>= 0)

  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (let c = 0; c < channels.length; c++) {
      const a = Math.abs(channels[c][i]);
      if (a > peak) peak = a;
    }
    const levelDb = 20 * Math.log10(peak + EPS);
    const under = p.thresholdDb - levelDb;
    const target = under > 0 ? under * (p.ratio - 1) : 0;
    // open fast (attack) when attenuation drops, close slow (release) when it grows
    const coeff = target < att ? attCoeff : relCoeff;
    att = target + (att - target) * coeff;
    const g = dbToLin(-att);
    for (let c = 0; c < channels.length; c++) channels[c][i] *= g;
  }
  return channels;
}

// --- Saturation: y = tanh(x*drive) / drive (clipping, warmth, fullness drive) ---
export function saturate(channels: Channels, drive: number): Channels {
  for (let c = 0; c < channels.length; c++) {
    const x = channels[c];
    for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * drive) / drive;
  }
  return channels;
}

// --- Harmonic excitation on a band, blended back (Blanket.presence) ---
export function presence(
  channels: Channels,
  sr: number,
  p: { lowHz: number; highHz: number; drive: number; blend: number },
): Channels {
  const c = bandpass(p.lowHz, p.highHz, sr);
  for (let ch = 0; ch < channels.length; ch++) {
    const data = channels[ch];
    const band = filtfilt(data, c);
    for (let i = 0; i < data.length; i++) {
      const harmonic = Math.tanh(band[i] * p.drive) / p.drive - band[i];
      data[i] += harmonic * p.blend;
    }
  }
  return channels;
}

// --- Mid-side stereo widening (Blanket.width); no-op on mono ---
export function width(channels: Channels, amount: number): Channels {
  if (channels.length < 2) return channels;
  const [L, R] = channels;
  for (let i = 0; i < L.length; i++) {
    const m = (L[i] + R[i]) / 2;
    const s = ((L[i] - R[i]) / 2) * (1 + amount);
    L[i] = m + s;
    R[i] = m - s;
  }
  return channels;
}

// --- Resonance detection: find up to 5 ringing peaks in 80–8000 Hz ---
// Returns center frequencies; the caller applies native notch filters.
export function detectResonances(channels: Channels, sr: number): number[] {
  const n = channels[0].length;
  const N = nextPow2(n);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < channels.length; c++) s += channels[c][i];
    re[i] = s / channels.length;
  }
  fft(re, im);

  const half = N / 2;
  const mag = new Float32Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]);

  // smooth (moving average ~ savgol stand-in)
  const w = 25;
  const sm = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    let acc = 0;
    let cnt = 0;
    for (let k = -w; k <= w; k++) {
      const j = i + k;
      if (j >= 0 && j < half) {
        acc += mag[j];
        cnt++;
      }
    }
    sm[i] = acc / cnt;
  }

  const sorted = Float32Array.from(sm).sort();
  const height = sorted[Math.floor(sorted.length * 0.95)];
  const binHz = sr / N;
  const minDist = 50;

  const peaks: number[] = [];
  let lastIdx = -minDist;
  for (let i = 1; i < half - 1 && peaks.length < 5; i++) {
    if (sm[i] > height && sm[i] > sm[i - 1] && sm[i] >= sm[i + 1] && i - lastIdx >= minDist) {
      const freq = i * binHz;
      if (freq > 80 && freq < 8000) {
        peaks.push(freq);
        lastIdx = i;
      }
    }
  }
  return peaks;
}

// --- Spectral gating (Blanket.denoise / roominess) ---
// v1 approximation of the `noisereduce` library: STFT, per-bin noise floor,
// attenuate bins near the floor by propDecrease. stationary=true uses a global
// floor (steady noise); stationary=false uses a time-local floor (room wash).
export function spectralGate(
  channels: Channels,
  p: { propDecrease: number; stationary: boolean },
): Channels {
  if (p.propDecrease <= 0) return channels;
  const FRAME = 2048;
  const HOP = FRAME / 4;
  const win = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);

  for (let c = 0; c < channels.length; c++) {
    channels[c] = gateChannel(channels[c], win, FRAME, HOP, p);
  }
  return channels;
}

function gateChannel(
  x: Float32Array,
  win: Float32Array,
  FRAME: number,
  HOP: number,
  p: { propDecrease: number; stationary: boolean },
): Float32Array {
  const n = x.length;
  const frames = Math.max(1, Math.ceil((n - FRAME) / HOP) + 1);
  const half = FRAME / 2;

  // forward STFT
  const specRe: Float32Array[] = [];
  const specIm: Float32Array[] = [];
  const mags: Float32Array[] = [];
  for (let f = 0; f < frames; f++) {
    const re = new Float32Array(FRAME);
    const im = new Float32Array(FRAME);
    const start = f * HOP;
    for (let i = 0; i < FRAME; i++) re[i] = (x[start + i] ?? 0) * win[i];
    fft(re, im);
    const mag = new Float32Array(half);
    for (let i = 0; i < half; i++) mag[i] = Math.hypot(re[i], im[i]);
    specRe.push(re);
    specIm.push(im);
    mags.push(mag);
  }

  // per-bin noise floor
  const floor = new Float32Array(half);
  if (p.stationary) {
    for (let b = 0; b < half; b++) {
      const col = new Float32Array(frames);
      for (let f = 0; f < frames; f++) col[f] = mags[f][b];
      col.sort();
      floor[b] = col[Math.floor(frames * 0.2)]; // 20th percentile ≈ noise level
    }
  }

  const keep = 1 - p.propDecrease;
  const SMOOTH = 30; // frames, for time-local floor

  for (let f = 0; f < frames; f++) {
    for (let b = 0; b < half; b++) {
      let fl = floor[b];
      if (!p.stationary) {
        let acc = 0;
        let cnt = 0;
        for (let k = -SMOOTH; k <= SMOOTH; k++) {
          const j = f + k;
          if (j >= 0 && j < frames) {
            acc += mags[j][b];
            cnt++;
          }
        }
        fl = acc / cnt; // local average = the sustained wash
      }
      const gainMask = mags[f][b] > fl * 1.5 ? 1 : keep;
      specRe[f][b] *= gainMask;
      specIm[f][b] *= gainMask;
      // mirror to keep the spectrum conjugate-symmetric
      if (b > 0 && b < half) {
        specRe[f][FRAME - b] *= gainMask;
        specIm[f][FRAME - b] *= gainMask;
      }
    }
  }

  // inverse STFT with overlap-add (COLA normalized)
  const out = new Float32Array(n);
  const norm = new Float32Array(n);
  for (let f = 0; f < frames; f++) {
    fft(specRe[f], specIm[f], true);
    const start = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      const idx = start + i;
      if (idx < n) {
        out[idx] += specRe[f][i] * win[i];
        norm[idx] += win[i] * win[i];
      }
    }
  }
  for (let i = 0; i < n; i++) out[i] = norm[i] > EPS ? out[i] / norm[i] : x[i];
  return out;
}
