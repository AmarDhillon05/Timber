# Single-Mic Drum Recording Tuning Parameters

## Frequency Balance (EQ)

### Low-End Rumble
- **Goal:** Remove HVAC noise, handling noise, mic vibrations.
- **How:** High-pass filter (typically 40–80 Hz).

### Kick Presence
- **Goal:** Make kick feel fuller and more defined.
- **How:** Boost or preserve roughly 60–120 Hz.

### Boxiness / Mud
- **Goal:** Reduce "cardboard" or "blanket-over-the-kit" sound.
- **How:** Cut roughly 200–500 Hz.

### Snare Body
- **Goal:** Add fullness without muddiness.
- **How:** Gentle boost around 150–250 Hz.

### Attack / Stick Definition
- **Goal:** Improve perceived crispness and articulation.
- **How:** Boost around 2–6 kHz.

### Harshness
- **Goal:** Tame painful cymbals or phone-mic brittleness.
- **How:** Cut around 4–8 kHz when excessive.

### Air / Openness
- **Goal:** Make recording sound more spacious and less dull.
- **How:** High-shelf boost around 8–15 kHz.

---

## Dynamics

### Overall Dynamic Range
- **Goal:** Make quiet and loud hits feel more balanced.
- **How:** Compression (threshold, ratio, attack, release).

### Transient Strength
- **Goal:** Increase perceived punch.
- **How:** Transient shaping or slow-attack compression.

### Sustain
- **Goal:** Control how long drums ring.
- **How:** Transient shaper sustain control, gating, expansion.

### Level Consistency
- **Goal:** Avoid hits disappearing or jumping out.
- **How:** Compression, upward compression, automation.

---

## Room / Ambience

### Roominess
- **Goal:** Reduce excessive room reflections.
- **How:** Downward expansion, dereverberation.

### Direct-to-Room Balance
- **Goal:** Make drums feel closer to listener.
- **How:** Reduce reverberant energy between hits.

### Background Noise
- **Goal:** Remove HVAC, fans, crowd noise, hiss.
- **How:** Noise reduction, spectral denoising.

---

## Spectral Characteristics

### Brightness
- **Goal:** Control overall brightness.
- **How:** Spectral tilt, shelving EQ.

### Spectral Balance
- **Goal:** Prevent overly bassy or thin recordings.
- **How:** Broad-band EQ adjustments.

### Resonances
- **Goal:** Remove ringing frequencies.
- **How:** Narrow EQ cuts (notches).

---

## Distortion / Artifacts

### Clipping
- **Goal:** Reduce audible distortion.
- **How:** Declipping algorithms, gain reduction.

### Pumping
- **Goal:** Prevent unnatural volume breathing.
- **How:** Gentler compression settings.

### Over-Sharpening
- **Goal:** Avoid brittle, artificial highs.
- **How:** Limit high-frequency boosts and transient enhancement.

---

## Harmonic Content

### Warmth
- **Goal:** Add fullness and character.
- **How:** Mild tape/tube saturation.

### Presence
- **Goal:** Help drums cut through.
- **How:** Light harmonic excitation.

---

## Stereo / Spatial (if outputting stereo)

### Width
- **Goal:** Increase sense of space.
- **How:** Stereo widening or synthetic ambience.

### Depth
- **Goal:** Control perceived distance.
- **How:** Reverb and ambience manipulation.

---

## Temporal Features

### Onset Clarity
- **Goal:** Make hits easier to perceive.
- **How:** Transient enhancement, expansion.

### Ringing
- **Goal:** Control excessive decay.
- **How:** Gating, dynamic EQ.

### Timing Stability
- **Goal:** Improve groove consistency.
- **How:** Transient alignment or editing (optional).

---

## Perceptual Targets (High-Level Objectives)

### Punch
- Increase transient strength
- Preserve low-end attack
- Reduce masking

### Crispness
- Enhance attack frequencies
- Reduce mud and roominess
- Maintain controlled brightness

### Fullness
- Preserve low mids
- Add mild saturation
- Avoid excessive high-pass filtering

### Naturalness
- Avoid over-processing
- Use dynamic/adaptive processing
- Preserve original transients and spectral balance

---

## Blanket Methods (`AudioFile.blanket.*`)

High-level perceptual controls. Each takes `amount: float = 1.0` (0 = no effect, 1 = standard treatment).

### EQ / Frequency

| Method | Target | Mechanism |
|---|---|---|
| `high_pass_rumble` | Low-End Rumble | High-pass filter, cutoff 40–80 Hz |
| `denoise` | Background Noise | Broadband spectral noise reduction |
| `kick_presence` | Kick Presence | Peak boost ~90 Hz |
| `snare_body` | Snare Body | Peak boost ~200 Hz |
| `boxiness` | Boxiness / Mud | Peak cut ~350 Hz |
| `attack` | Attack / Stick Definition | Peak boost ~4 kHz |
| `harshness` | Harshness | Peak cut ~6 kHz |
| `air` | Air / Openness | High-shelf boost above 10 kHz |
| `brightness` | Brightness | High-shelf tilt at 8 kHz |
| `resonance` | Resonances | Auto-detect and notch up to 5 peaks |

### Dynamics

| Method | Target | Mechanism |
|---|---|---|
| `dynamic_range` | Overall Dynamic Range | Compression, ratio 1–4 |
| `punch` | Transient Strength | Slow-attack compression |
| `sustain` | Sustain / Ringing | Noise gate / expansion |
| `consistency` | Level Consistency | Fast compression |
| `pumping` | Pumping Artifact | Long-release compression |

### Room / Spatial

| Method | Target | Mechanism |
|---|---|---|
| `roominess` | Roominess | Non-stationary spectral gating |
| `width` | Stereo Width | Mid-side widening |
| `depth` | Perceived Depth | Subtle reverb |

### Artifacts

| Method | Target | Mechanism |
|---|---|---|
| `clipping` | Clipping | Soft-knee tanh limiter |

### Harmonic

| Method | Target | Mechanism |
|---|---|---|
| `warmth` | Warmth | Soft tanh saturation |
| `presence` | Presence | Harmonic excitation on 2–8 kHz |
| `fullness` | Fullness | Low-mid boost + mild saturation |

### Perceptual

| Method | Target | Mechanism |
|---|---|---|
| `naturalness` | Naturalness | Gentle brick-wall limiter, guards against over-processing |