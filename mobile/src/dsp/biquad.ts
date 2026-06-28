// Audio EQ Cookbook biquads + zero-phase (forward-backward) filtering.
// Used internally by the custom effects (e.g. presence's band split). The
// chain's main EQ runs on native BiquadFilterNodes instead — see render.ts.

export interface Coeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
} // a0 normalized to 1

export function bandpass(lowHz: number, highHz: number, fs: number): Coeffs {
  const f0 = Math.sqrt(lowHz * highHz);
  const q = f0 / (highHz - lowHz);
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * Math.cos(w0)) / a0,
    a2: (1 - alpha) / a0,
  };
}

// Single-pass Direct Form I.
function pass(x: Float32Array, c: Coeffs): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xn = x[i];
    const yn = c.b0 * xn + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = xn;
    y2 = y1;
    y1 = yn;
    y[i] = yn;
  }
  return y;
}

// Zero-phase: filter forward, then backward (≈ scipy sosfiltfilt, order 2).
export function filtfilt(x: Float32Array, c: Coeffs): Float32Array {
  const fwd = pass(x, c);
  fwd.reverse();
  const back = pass(fwd, c);
  back.reverse();
  return back;
}
