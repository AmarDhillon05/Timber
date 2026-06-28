# Timber DSP — Blanket Methods

TypeScript port of `functions/blanket.py` + `functions/audiofile.py`, running on
[`react-native-audio-api`](https://docs.swmansion.com/react-native-audio-api/).

`AudioFile` holds the decoded PCM and the low-level DSP primitives (cookbook
filters, EQ, gain). `AudioFile.blanket` is the high-level perceptual layer: each
method maps a single `amount` knob onto those primitives.

## The `amount` convention

Every `blanket.*` method takes `amount: number = 1.0`:

- **`0`** → no effect (bypass / flat)
- **`1`** → standard treatment (the calibrated "normal" amount)
- Values are **not clamped** — push past `1` to exaggerate.
- **Exception:** `brightness` also accepts **negative** values, which darken/warm
  the kit instead of brightening it.

## Basic usage

Calls are chainable and deferred — nothing runs until `render()`. The same chain
can drive a live preview graph or an offline export.

```ts
import { AudioFile } from './dsp';

// decode an audio or video file (mp4 / m4a / mp3 / wav) → PCM
const a = await AudioFile.decode(uri);

// build a chain (order matters — applied top to bottom)
a.blanket.high_pass_rumble(0.5); // trim sub-bass rumble
a.blanket.kick_presence(0.8); // fuller kick
a.blanket.attack(0.6); // crisper stick
a.blanket.warmth(0.3); // gentle saturation

// execute the whole chain offline
const { channels, sampleRate } = await a.render();
```

Each method returns the `AudioFile`, so you can also fluently chain:

```ts
const a = await AudioFile.decode(uri);
a.blanket.boxiness(0.5);
a.blanket.harshness(0.4);
a.blanket.depth(0.3);
const out = await a.render();
```

---

## EQ / Frequency

| Method | Target | `amount = 0` → `amount = 1` |
|---|---|---|
| `high_pass_rumble` | Low-end rumble | high-pass cutoff 40 Hz → 80 Hz |
| `denoise` | Background noise | no reduction → full broadband spectral reduction |
| `kick_presence` | Kick presence | flat → +3 dB peak @ 90 Hz |
| `snare_body` | Snare body | flat → +2.5 dB peak @ 200 Hz |
| `boxiness` | Boxiness / mud | flat → −3 dB dip @ 350 Hz |
| `attack` | Stick definition | flat → +3 dB peak @ 4 kHz |
| `harshness` | Harshness | flat → −2.5 dB dip @ 6 kHz |
| `air` | Air / openness | flat → +3 dB high-shelf @ 10 kHz |
| `brightness` | Brightness tilt | flat → +2 dB high-shelf @ 8 kHz (negative darkens) |
| `resonance` | Ringing resonances | untouched → notch up to 5 detected peaks (Q 0 → 30) |

```ts
// Remove HVAC/stage rumble below the kit, then add weight to the kick.
a.blanket.high_pass_rumble(1.0);
a.blanket.kick_presence(0.7);

// Tame a boxy, harsh phone-mic recording.
a.blanket.boxiness(0.6);
a.blanket.harshness(0.5);

// Open up a dull recording.
a.blanket.air(0.8);

// Brighten (positive) or darken (negative).
a.blanket.brightness(0.5); //  brighter
a.blanket.brightness(-0.4); // darker / warmer

// Auto-detect and surgically notch ringing room/kit resonances.
a.blanket.resonance(1.0);
```

## Dynamics

| Method | Target | `amount = 0` → `amount = 1` |
|---|---|---|
| `dynamic_range` | Overall dynamics | 1:1 bypass → 4:1 compression (thr −18 dB) |
| `punch` | Transient strength | bypass → 3:1 with 30 ms slow attack (thr −20 dB) |
| `sustain` | Ring / decay | no gating → 3:1 noise gate (thr −40 dB) |
| `consistency` | Level consistency | bypass → 2:1 fast compression (thr −12 dB) |
| `pumping` | Pumping artifact | bypass → 2:1 with 500 ms long release (thr −18 dB) |

```ts
// Even out quiet vs loud hits.
a.blanket.dynamic_range(0.6);

// Accentuate the initial crack of each hit (slow-attack compression).
a.blanket.punch(0.8);

// Tighten ringing tails / cut bleed between hits.
a.blanket.sustain(0.5);

// Smooth out audible "breathing" from fast compression.
a.blanket.pumping(0.7);
```

## Room / Spatial

| Method | Target | `amount = 0` → `amount = 1` |
|---|---|---|
| `roominess` | Excess reflections | none → full non-stationary room reduction |
| `width` | Stereo width | unchanged → side signal doubled (no-op on mono) |
| `depth` | Perceived distance | dry → small room reverb @ 15% wet |

```ts
// Dry out a washy room without touching the hits.
a.blanket.roominess(0.7);

// Widen the stereo image (ignored on mono files).
a.blanket.width(0.5);

// Push the kit back in the mix with a subtle reverb tail.
a.blanket.depth(0.4);
```

## Artifacts

| Method | Target | `amount = 0` → `amount = 1` |
|---|---|---|
| `clipping` | Existing clipping | drive 1 (near-transparent) → drive 2 (soften clipped peaks) |

```ts
// Round the brittle edges of already-clipped transients.
a.blanket.clipping(0.6);
```

## Harmonic

| Method | Target | `amount = 0` → `amount = 1` |
|---|---|---|
| `warmth` | Warmth / character | drive 1 → drive 3 tanh saturation |
| `presence` | Cut-through | dry → 30% harmonic blend on the 2–8 kHz band |
| `fullness` | Density | bypass → +1.5 dB @ 200 Hz + drive 1.5 saturation |

```ts
// Tape/tube-style fullness across the whole kit.
a.blanket.warmth(0.4);

// Add sheen so drums cut through a busy mix (harmonic excitation, not EQ).
a.blanket.presence(0.6);

// Thicken a thin-sounding kit.
a.blanket.fullness(0.5);
```

## Perceptual

| Method | Target | `amount = 0` → `amount = 1` |
|---|---|---|
| `naturalness` | Anti over-processing | 1:1 → 20:1 brick-wall limiting @ −3 dBFS |

```ts
// Guard the output against distortion from heavy upstream processing.
// Typically placed LAST in the chain.
a.blanket.naturalness(1.0);
const out = await a.render();
```

---

## Notes on fidelity vs. the Python

- Filters run as **single-pass causal** biquads (native `BiquadFilterNode`), so EQ
  gains are the nominal cookbook values — not the doubled-magnitude, zero-phase
  result the Python's `scipy` `sosfiltfilt` produces.
- `denoise` / `roominess` use a v1 spectral-gating approximation of the Python's
  `noisereduce` dependency, not a line-for-line port.
