import { AudioFile } from './AudioFile';
import { BLANKET_TERMS, BLANKET_TERM_KEYS, type BlanketTerm } from './blanketTerms';
import type { Channels } from './types';

// Slider values are −1..1; this widens them so the effects are clearly audible.
// Each Blanket method already multiplies its amount by a fixed coefficient, so
// the effective swing is value × INTENSITY × that coefficient.
export const INTENSITY = 3;

// Build the Blanket chain from the current slider values and render it to
// processed PCM. Terms at 0 are skipped, so an all-zero set renders a clean
// pass-through copy of the source (identical to the decoded original). Bipolar
// terms keep their sign (boost/cut); the rest use magnitude.
export async function renderBlanket(
  pcm: Channels,
  sampleRate: number,
  values: Record<BlanketTerm, number>,
): Promise<Channels> {
  const file = new AudioFile(pcm, sampleRate);
  for (const term of BLANKET_TERM_KEYS) {
    const value = values[term];
    if (value === 0) continue;
    const signed = BLANKET_TERMS[term].bipolar ? value : Math.abs(value);
    file.blanket[term](signed * INTENSITY);
  }
  const { channels } = await file.render();
  return channels;
}
