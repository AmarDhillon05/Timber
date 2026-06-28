import type { AudioFile } from './AudioFile';
import type { Blanket } from './Blanket';

// Every Blanket method that maps amount:0..1 onto the DSP chain. Derived from
// the class itself, so it stays exactly in sync with the DSP module.
export type BlanketTerm = {
  [K in keyof Blanket]: Blanket[K] extends (amount?: number) => AudioFile ? K : never;
}[keyof Blanket];

export type BlanketCategory =
  | 'Frequency'
  | 'Dynamics'
  | 'Room / Spatial'
  | 'Harmonic'
  | 'Artifacts'
  | 'Perceptual';

// Render order for the grouped slider list.
export const CATEGORY_ORDER: BlanketCategory[] = [
  'Frequency',
  'Dynamics',
  'Room / Spatial',
  'Harmonic',
  'Artifacts',
  'Perceptual',
];

// `bipolar` terms are EQ boosts/cuts where a negative value is a sensible
// opposite (cut instead of boost). The rest are one-directional intensities
// (distortion, reverb, denoise, dynamics); they use |value|, so the negative
// half of the slider mirrors the positive and never feeds an invalid param.
export interface BlanketTermInfo {
  label: string;
  category: BlanketCategory;
  bipolar: boolean;
  // One-line plain-English explanation, surfaced as a hover tooltip on the knob.
  description: string;
}

// A Record (not an array) so the compiler requires an entry for every
// BlanketTerm — adding a method to Blanket breaks the build until it's listed.
export const BLANKET_TERMS: Record<BlanketTerm, BlanketTermInfo> = {
  high_pass_rumble: {
    label: 'Rumble (high-pass)',
    category: 'Frequency',
    bipolar: false,
    description: 'Rolls off sub-bass rumble, handling thumps and stage vibration below the music.',
  },
  denoise: {
    label: 'Denoise',
    category: 'Frequency',
    bipolar: false,
    description: 'Reduces steady background noise — hiss, hum and HVAC drone.',
  },
  kick_presence: {
    label: 'Kick presence',
    category: 'Frequency',
    bipolar: true,
    description: 'Boosts the low-end weight and body of the kick drum (cut when negative).',
  },
  snare_body: {
    label: 'Snare body',
    category: 'Frequency',
    bipolar: true,
    description: 'Adds fullness and body to a thin snare (thins it out when negative).',
  },
  boxiness: {
    label: 'Boxiness',
    category: 'Frequency',
    bipolar: true,
    description: 'Tames hollow, boxy low-mid resonance (adds it back when negative).',
  },
  attack: {
    label: 'Attack',
    category: 'Frequency',
    bipolar: true,
    description: 'Sharpens stick attack and transient definition (softens when negative).',
  },
  harshness: {
    label: 'Harshness',
    category: 'Frequency',
    bipolar: true,
    description: 'Smooths harsh, brittle cymbals and bright mids (adds bite when negative).',
  },
  air: {
    label: 'Air',
    category: 'Frequency',
    bipolar: true,
    description: 'Adds open high-end air and sparkle (darkens when negative).',
  },
  brightness: {
    label: 'Brightness',
    category: 'Frequency',
    bipolar: true,
    description: 'Lifts overall brightness on a dull, muffled recording (darkens when negative).',
  },
  resonance: {
    label: 'Resonance',
    category: 'Frequency',
    bipolar: false,
    description: 'Notches out ringing resonant frequency peaks.',
  },

  dynamic_range: {
    label: 'Dynamic range',
    category: 'Dynamics',
    bipolar: false,
    description: 'Controls the spread between the loudest and quietest hits.',
  },
  detail: {
    label: 'Detail',
    category: 'Dynamics',
    bipolar: false,
    description: 'Brings out fine low-level detail and articulation.',
  },
  punch: {
    label: 'Punch',
    category: 'Dynamics',
    bipolar: false,
    description: 'Enhances transient impact so hits feel punchier.',
  },
  sustain: {
    label: 'Sustain',
    category: 'Dynamics',
    bipolar: false,
    description: 'Shapes the ring-out and tails between hits.',
  },
  consistency: {
    label: 'Consistency',
    category: 'Dynamics',
    bipolar: false,
    description: 'Evens out hits that jump inconsistently in and out.',
  },
  pumping: {
    label: 'Pumping',
    category: 'Dynamics',
    bipolar: false,
    description: 'Reduces unnatural pumping and breathing from compression.',
  },

  roominess: {
    label: 'Roominess',
    category: 'Room / Spatial',
    bipolar: false,
    description: 'Controls room reflections and reverberant wash.',
  },
  width: {
    label: 'Width',
    category: 'Room / Spatial',
    bipolar: false,
    description: 'Widens a narrow, mono-sounding stereo image.',
  },
  depth: {
    label: 'Depth',
    category: 'Room / Spatial',
    bipolar: false,
    description: 'Adds a front-to-back sense of distance and space.',
  },

  warmth: {
    label: 'Warmth',
    category: 'Harmonic',
    bipolar: false,
    description: 'Adds analog warmth to a cold, sterile recording.',
  },
  presence: {
    label: 'Presence',
    category: 'Harmonic',
    bipolar: false,
    description: 'Helps the drums cut through and sit forward in the mix.',
  },
  fullness: {
    label: 'Fullness',
    category: 'Harmonic',
    bipolar: false,
    description: 'Fills out a thin, hollow-sounding recording.',
  },

  clipping: {
    label: 'Clipping',
    category: 'Artifacts',
    bipolar: false,
    description: 'Tames harsh digital clipping and distorted peaks.',
  },

  naturalness: {
    label: 'Naturalness',
    category: 'Perceptual',
    bipolar: false,
    description: 'Keeps the result natural and un-over-processed — a gentle brick-wall guard.',
  },
};

export const BLANKET_TERM_KEYS = Object.keys(BLANKET_TERMS) as BlanketTerm[];
