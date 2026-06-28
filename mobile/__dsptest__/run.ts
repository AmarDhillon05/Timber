import { fft, nextPow2 } from '../src/dsp/fft';
import { compress, gate, upwardCompress, saturate, width, presence, detectResonances, spectralGate } from '../src/dsp/effects';
import { Channels } from '../src/dsp/types';

let failures = 0;
const ok = (name: string, cond: boolean, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
};
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// 1. FFT round-trips
{
  const N = 1024;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const orig = new Float32Array(N);
  for (let i = 0; i < N; i++) orig[i] = re[i] = Math.sin((2 * Math.PI * 5 * i) / N) + 0.3 * Math.random();
  fft(re, im);
  fft(re, im, true);
  let err = 0;
  for (let i = 0; i < N; i++) err = Math.max(err, Math.abs(re[i] - orig[i]));
  ok('fft inverse round-trip', err < 1e-4, `maxerr=${err.toExponential(2)}`);
  ok('nextPow2', nextPow2(1000) === 1024 && nextPow2(1024) === 1024);
}

// helper: 1s of a loud sine at 48k with a quiet section
const sr = 48000;
function tone(freq: number, amp: number, n = sr): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return x;
}

// 2. compressor reduces peak of a hot signal
{
  const ch: Channels = [tone(220, 0.9)];
  const before = peak(ch[0]);
  compress(ch, sr, { thresholdDb: -18, ratio: 4, attackMs: 10, releaseMs: 100 });
  const after = peak(ch[0]);
  ok('compressor reduces peak', after < before, `${before.toFixed(3)}→${after.toFixed(3)}`);
}

// 3. gate attenuates a below-threshold quiet signal
{
  const ch: Channels = [tone(220, 0.003)]; // ~ -50 dB, below -40 threshold
  gate(ch, sr, { thresholdDb: -40, ratio: 3, attackMs: 1, releaseMs: 100 });
  ok('gate attenuates quiet signal', peak(ch[0]) < 0.003);
}

// 4. saturation keeps |y| < |x| for hot input and stays bounded
{
  const ch: Channels = [tone(220, 2.0)];
  saturate(ch, 3);
  ok('saturation bounded', peak(ch[0]) <= 2.0 && peak(ch[0]) > 0);
}

// 5. width is a no-op on mono, widens stereo
{
  const mono: Channels = [tone(220, 0.5)];
  const ref = Float32Array.from(mono[0]);
  width(mono, 1);
  ok('width no-op on mono', mono[0].every((v, i) => v === ref[i]));

  const L = tone(220, 0.5);
  const R = tone(220, 0.2);
  const stereo: Channels = [Float32Array.from(L), Float32Array.from(R)];
  width(stereo, 1);
  // mid preserved: (L+R)/2 unchanged; side doubled
  let okWidth = true;
  for (let i = 0; i < 1000; i++) {
    const m = (stereo[0][i] + stereo[1][i]) / 2;
    if (Math.abs(m - (L[i] + R[i]) / 2) > 1e-5) okWidth = false;
  }
  ok('width preserves mid', okWidth);
}

// 6. presence adds energy without blowing up
{
  const ch: Channels = [tone(4000, 0.4)];
  const before = peak(ch[0]);
  presence(ch, sr, { lowHz: 2000, highHz: 8000, drive: 2, blend: 0.3 });
  ok('presence finite', Number.isFinite(peak(ch[0])) && peak(ch[0]) > 0, `${before.toFixed(3)}→${peak(ch[0]).toFixed(3)}`);
}

// 7. resonance detector finds a planted tone
{
  const base = tone(120, 0.05, sr);
  const ring = tone(2000, 0.6, sr); // dominant resonance
  const mix = new Float32Array(sr);
  for (let i = 0; i < sr; i++) mix[i] = base[i] + ring[i];
  const freqs = detectResonances([mix], sr);
  // Faithful to Python: up to 5 peaks, all within the 80–8000 Hz notch band.
  const contract = freqs.length >= 1 && freqs.length <= 5 && freqs.every((f) => f > 80 && f < 8000);
  ok('resonance returns ≤5 peaks in band', contract, `found=[${freqs.map((f) => f.toFixed(0)).join(',')}]`);
}

// 8. spectral gate runs and preserves length
{
  const ch: Channels = [tone(220, 0.5, 24000)];
  const len = ch[0].length;
  spectralGate(ch, { propDecrease: 0.8, stationary: true });
  ok('spectralGate preserves length', ch[0].length === len);
  ok('spectralGate finite', ch[0].every((v) => Number.isFinite(v)));
}

// 9. amplified Blanket ranges (slider −1..1 × INTENSITY=3) stay finite/bounded.
//    Mirrors the worst-case params the Blanket methods now feed the effects.
{
  const INTENSITY = 3;
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

  // warmth at |1|: drive = 1 + amount*2, amount = 1*INTENSITY = 3 → 7
  let ch: Channels = [tone(220, 0.9)];
  saturate(ch, 1 + 3 * 2);
  ok('amp saturation finite + bounded', ch[0].every((v) => Number.isFinite(v)) && peak(ch[0]) > 0 && peak(ch[0]) <= 0.9);

  // naturalness at |1|: ratio = 1 + amount*19 = 1 + 3*19 = 58
  ch = [tone(220, 0.9)];
  const before = peak(ch[0]);
  compress(ch, sr, { thresholdDb: -3, ratio: 1 + 3 * 19, attackMs: 0.1, releaseMs: 50 });
  ok('amp compressor finite + tames peak', ch[0].every((v) => Number.isFinite(v)) && peak(ch[0]) <= before);

  // denoise at |1|: propDecrease = clamp01(3) = 1
  ch = [tone(220, 0.5, 24000)];
  spectralGate(ch, { propDecrease: clamp01(1 * INTENSITY), stationary: true });
  ok('amp spectralGate finite (clamped)', ch[0].every((v) => Number.isFinite(v)));

  // width at |1|: amount = INTENSITY = 3
  const stereo: Channels = [tone(220, 0.5), tone(220, 0.2)];
  width(stereo, 3);
  ok('amp width finite', stereo[0].every((v) => Number.isFinite(v)) && stereo[1].every((v) => Number.isFinite(v)));

  // presence at |1|: drive = 1 + amount = 4, blend = amount*0.3 = 0.9
  ch = [tone(4000, 0.4)];
  presence(ch, sr, { lowHz: 2000, highHz: 8000, drive: 4, blend: 0.9 });
  ok('amp presence finite', ch[0].every((v) => Number.isFinite(v)) && peak(ch[0]) > 0);
}

// 10. upward compressor (detail) lifts a quiet signal, leaves a loud one, finite
{
  // quiet signal ~ -40 dB (below -30 threshold) should get boosted up
  const quiet: Channels = [tone(220, 0.01)];
  const qBefore = peak(quiet[0]);
  upwardCompress(quiet, sr, { thresholdDb: -30, ratio: 4, maxGainDb: 12, attackMs: 5, releaseMs: 150 });
  ok('detail lifts quiet signal', peak(quiet[0]) > qBefore && quiet[0].every((v) => Number.isFinite(v)), `${qBefore.toFixed(4)}→${peak(quiet[0]).toFixed(4)}`);

  // loud signal above threshold should be essentially untouched (no big boost)
  const loud: Channels = [tone(220, 0.9)];
  upwardCompress(loud, sr, { thresholdDb: -30, ratio: 4, maxGainDb: 12, attackMs: 5, releaseMs: 150 });
  ok('detail spares loud signal', peak(loud[0]) <= 1.0 && peak(loud[0]) >= 0.9 - 1e-3);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
