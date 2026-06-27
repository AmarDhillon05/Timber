# CLAP Blanket Prompts

These are the canonical zero-shot prompts the **CLAP** backend scores each audio
file against. CLAP is contrastive (audio↔text): for every blanket term it
measures how similar the audio is to that term's prompt, and the similarity
becomes the suggested `amount`. Phrase each prompt as *the condition the term
corrects or adds* — i.e. describe what the audio sounds like when you'd want
that treatment dialed up.

Format: one `term: prompt` per line. The term must match a blanket term in
`functions/blanket.py` / `inference/inference.py`. Headings and blank lines are
ignored. The frontend can layer extra context on top of these at request time
(appended to every prompt) without editing this file.

## EQ / Frequency

high_pass_rumble: low frequency rumble, sub-bass noise and stage vibration
denoise: steady background noise, hiss and HVAC hum
kick_presence: a weak thin kick drum lacking low-end body
snare_body: a thin snare drum lacking fullness and body
boxiness: boxy hollow cardboard sounding midrange
attack: drums lacking stick attack and transient definition
harshness: harsh brittle painful cymbals and bright midrange
air: a dull closed-in recording lacking high-end air
brightness: a dark muffled recording lacking brightness
resonance: ringing resonant frequencies and tonal peaks

## Dynamics

dynamic_range: very uneven loud and quiet hits, wide dynamic range
punch: drums lacking punch and transient impact
sustain: long ringing drum tails and bleed between hits
consistency: inconsistent hit levels jumping in and out
pumping: unnatural pumping and breathing volume swells

## Room / Spatial

roominess: excessive room reflections and reverberant wash
width: a narrow mono-sounding stereo image
depth: a flat dry recording with no sense of distance

## Artifacts

clipping: harsh digital clipping and distorted peaks

## Harmonic

warmth: a cold sterile digital sounding recording
presence: drums that do not cut through the mix
fullness: a thin hollow lacking body recording

## Perceptual

naturalness: an over-processed unnatural sounding recording
