// Synthetic impulse response for ConvolverNode, approximating pedalboard.Reverb
// (a Freeverb room). Exponentially-decaying noise, low-passed by `damping`.

export function makeImpulseResponse(
  ctx: { createBuffer(ch: number, len: number, sr: number): any },
  sr: number,
  roomSize: number,
  damping: number,
): any {
  const decay = 0.1 + roomSize * 3.0; // seconds
  const len = Math.max(1, Math.floor(sr * decay));
  const ir = ctx.createBuffer(2, len, sr);
  const lpCoeff = 1 - Math.min(0.999, damping); // one-pole low-pass on the tail
  for (let c = 0; c < 2; c++) {
    const data = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, 2) * Math.exp(-3 * (i / sr) / decay);
      const noise = Math.random() * 2 - 1;
      lp += lpCoeff * (noise - lp);
      data[i] = lp * env;
    }
  }
  return ir;
}
