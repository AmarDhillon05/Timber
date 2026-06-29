import { encodeWavMono16 } from '../audio/wav';
import { BLANKET_TERM_KEYS, type BlanketTerm } from '../dsp/blanketTerms';
import { postSuggest } from './inferenceApi';
import type { Channels } from '../dsp';
import type { BlanketValues } from '../data/TrackFile';

// Suggest blanket amounts for a clip via the /inference service. The HTTP plumbing
// and error handling live in inferenceApi; this module just builds the upload and
// maps the response onto our blanket values.

const TERM_SET = new Set<string>(BLANKET_TERM_KEYS);

export interface SuggestOptions {
  // Free-text appended to every CLAP prompt to bias scoring (e.g. "live drum
  // kit, noisy room"). CLAP only; ignored by the AudioSet taggers.
  context?: string;
  // The user's current slider values. Non-zero terms are sent as an
  // inclination the backend blends its suggestions toward.
  inclination?: BlanketValues;
}

// Send the decoded audio to the inference service and map its suggestions onto
// our blanket values. Terms the service doesn't return (e.g. `detail`) stay 0.
export async function suggestBlanket(
  pcm: Channels,
  sampleRate: number,
  options: SuggestOptions = {},
): Promise<BlanketValues> {
  const wav = encodeWavMono16(pcm, sampleRate);
  const form = new FormData();
  // Web path: a Blob in FormData uploads as the multipart `file` field. On
  // native, FormData expects a {uri,name,type} file object instead.
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');

  const context = options.context?.trim();
  if (context) form.append('context', context);

  if (options.inclination) {
    // Only send terms the user actually moved — those are the inclination the
    // backend blends toward; untouched (0) terms are left to the model.
    const incl: Record<string, number> = {};
    for (const [term, value] of Object.entries(options.inclination)) {
      if (value) incl[term] = value;
    }
    if (Object.keys(incl).length > 0) form.append('inclination', JSON.stringify(incl));
  }

  const data = await postSuggest(form);

  const values = {} as BlanketValues;
  for (const key of BLANKET_TERM_KEYS) values[key] = 0;
  for (const { term, amount } of data.suggestions ?? []) {
    if (TERM_SET.has(term)) {
      values[term as BlanketTerm] = Math.max(-1, Math.min(1, Number(amount) || 0));
    }
  }
  return values;
}
