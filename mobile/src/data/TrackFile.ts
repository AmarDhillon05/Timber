// The app's central document type. A TrackFile is one editing session: several
// aligned audio tracks plus an optional video. Each track carries its own
// decoded PCM and its own Blanket edit state, so the editor can hold different
// settings per track — the values live ON the track (not in a side store),
// which is also where each track's usage tally belongs.

import { AudioFile } from '../dsp';
import type { Channels, EffectSpec } from '../dsp';
import { INTENSITY } from '../dsp/renderBlanket';
import { TARGET_SAMPLE_RATE } from '../dsp/AudioFile';
import {
  BLANKET_TERM_KEYS,
  BLANKET_TERMS,
  type BlanketTerm,
} from '../dsp/blanketTerms';

export type BlanketValues = Record<BlanketTerm, number>;
export type BlanketMode = 'user' | 'generated';
/** Every concrete effect primitive a Blanket term can expand into. */
export type EffectKind = EffectSpec['kind'];

// Counts of how much each knob, and each sub-effect that knob expands into, is
// engaged on a track. Held as integer counts (not cumulative amounts) so they
// compose by +1/−1: trivial to bump as the chain is built and to roll back.
export interface TrackUsage {
  blanket: Partial<Record<BlanketTerm, number>>;
  effect: Partial<Record<EffectKind, number>>;
}

export interface Track {
  id: string;
  /** Display name, e.g. "Drums", "Backing". */
  name: string;
  /** Persistent file:// URI — the source of truth for decode and export. */
  uri: string;
  /** Decoded PCM, held by reference for stateful processing. null until decoded. */
  pcm: Channels | null;
  sampleRate: number;
  /** Editable tracks expose Blanket controls; non-editable ones mix in raw. */
  editable: boolean;
  // Per-track Blanket edit state (formerly the single global blanket store).
  mode: BlanketMode;
  user: BlanketValues;
  generated: BlanketValues;
  /** How much each knob / sub-effect is currently applied to this track. */
  usage: TrackUsage;
}

export interface TrackFile {
  id: string;
  name: string;
  tracks: Track[];
  /** Optional aligned video; played muted while the mixed audio plays in its place. */
  video: { uri: string; name: string } | null;
}

// Every term defaults to 0 (neutral); sliders/knobs run −1..1.
export const zeroValues = (): BlanketValues =>
  Object.fromEntries(BLANKET_TERM_KEYS.map((k) => [k, 0])) as BlanketValues;

/** The value set the editor is currently acting on for this track. */
export const trackActiveValues = (t: Track): BlanketValues =>
  t.mode === 'generated' ? t.generated : t.user;

export const editableTracks = (f: TrackFile): Track[] =>
  f.tracks.filter((t) => t.editable);

// Tally the chain a set of values would build: +1 for each engaged knob and +1
// per sub-effect spec it expands into. Mirrors renderBlanket's construction
// (an empty probe AudioFile is only used to collect specs — never rendered), so
// the counts always match what actually gets applied. Because it's derived from
// the values, recomputing on every change keeps it in sync and makes reversing
// a knob (back toward 0) just drop its counts.
export function tallyUsage(values: BlanketValues): TrackUsage {
  const blanket: Partial<Record<BlanketTerm, number>> = {};
  const effect: Partial<Record<EffectKind, number>> = {};
  const probe = new AudioFile([], TARGET_SAMPLE_RATE);

  for (const term of BLANKET_TERM_KEYS) {
    const value = values[term];
    if (value === 0) continue;
    blanket[term] = (blanket[term] ?? 0) + 1;

    const before = probe.chain.length;
    const signed = BLANKET_TERMS[term].bipolar ? value : Math.abs(value);
    probe.blanket[term](signed * INTENSITY);
    for (let i = before; i < probe.chain.length; i++) {
      const kind = probe.chain[i].kind;
      effect[kind] = (effect[kind] ?? 0) + 1;
    }
  }
  return { blanket, effect };
}

let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${seq++}`;

export function makeTrack(opts: {
  name: string;
  uri: string;
  editable?: boolean;
  sampleRate?: number;
}): Track {
  return {
    id: uid('track'),
    name: opts.name,
    uri: opts.uri,
    pcm: null,
    sampleRate: opts.sampleRate ?? TARGET_SAMPLE_RATE,
    editable: opts.editable ?? true,
    mode: 'user',
    user: zeroValues(),
    generated: zeroValues(),
    usage: { blanket: {}, effect: {} },
  };
}

export function makeTrackFile(opts: {
  name: string;
  tracks: Track[];
  video?: { uri: string; name: string } | null;
}): TrackFile {
  return {
    id: uid('file'),
    name: opts.name,
    tracks: opts.tracks,
    video: opts.video ?? null,
  };
}
