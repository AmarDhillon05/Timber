from __future__ import annotations
import numpy as np
from scipy.signal import butter, sosfiltfilt, find_peaks, savgol_filter
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .audiofile import AudioFile


class Blanket:
    """High-level perceptual methods that wrap the raw DSP primitives on AudioFile."""

    def __init__(self, audio: "AudioFile"):
        self._a = audio

    def _pb(self, *plugins) -> "AudioFile":
        import pedalboard
        board = pedalboard.Pedalboard(list(plugins))
        audio_T = self._a.data.T.astype(np.float32)
        self._a.data = board(audio_T, self._a.sample_rate).T.astype(np.float64)
        return self._a

    # --- EQ / Frequency ---

    def high_pass_rumble(self, amount: float = 1.0) -> "AudioFile":
        """
        Remove low-frequency rumble below the drum kit.

        Raises the high-pass cutoff as amount increases, trimming sub-bass
        energy that muddies the mix without contributing musically.

        amount=0 : soft cut at 40 Hz — leaves almost all low-end intact
        amount=1 : firmer cut at 80 Hz — removes typical HVAC and stage rumble
        """
        cutoff_hz = 40 + amount * 40   # 40 Hz → 80 Hz
        return self._a.high_pass(cutoff_hz)

    def denoise(self, amount: float = 1.0) -> "AudioFile":
        """
        Broadband spectral noise reduction for steady-state background noise.

        Targets constant noise floors like HVAC hiss, fan rumble, or crowd
        wash. Higher amounts reduce the noise floor more aggressively.

        amount=0 : no noise reduction applied
        amount=1 : full noise reduction — up to 100% of detected noise removed
        """
        import noisereduce as nr
        prop_decrease = amount   # 0.0 → 1.0 (fraction of noise removed)
        for ch in range(self._a.data.shape[1]):
            self._a.data[:, ch] = nr.reduce_noise(
                y=self._a.data[:, ch],
                sr=self._a.sample_rate,
                prop_decrease=prop_decrease,
            )
        return self._a

    def kick_presence(self, amount: float = 1.0) -> "AudioFile":
        """
        Boost the 60–120 Hz range for a fuller, more defined kick drum.

        Adds low-end weight centered at 90 Hz so the kick drum "speaks"
        clearly, especially on smaller playback systems.

        amount=0 : no boost (flat)
        amount=1 : +3 dB peak at 90 Hz
        """
        gain_db = amount * 3.0   # 0 dB → +3 dB
        return self._a.peak_eq(90, gain_db, 1.2)

    def snare_body(self, amount: float = 1.0) -> "AudioFile":
        """
        Boost the 150–250 Hz range for snare fullness and thickness.

        Adds wood and body to a thin-sounding snare by lifting the
        fundamental centered at 200 Hz.

        amount=0 : no boost (flat)
        amount=1 : +2.5 dB peak at 200 Hz
        """
        gain_db = amount * 2.5   # 0 dB → +2.5 dB
        return self._a.peak_eq(200, gain_db, 1.5)

    def boxiness(self, amount: float = 1.0) -> "AudioFile":
        """
        Cut the 200–500 Hz range to reduce a cardboard or telephone character.

        Reduces the "boxy" mid-range buildup that makes drums sound
        hollow or lo-fi. Centered at 350 Hz.

        amount=0 : no cut (flat)
        amount=1 : −3 dB dip at 350 Hz
        """
        gain_db = -amount * 3.0   # 0 dB → −3 dB
        return self._a.peak_eq(350, gain_db, 0.8)

    def attack(self, amount: float = 1.0) -> "AudioFile":
        """
        Boost the 2–6 kHz range for stick definition and transient crispness.

        Lifts the attack point of hits so each drum stroke lands with
        clarity. Centered at 4 kHz.

        amount=0 : no boost (flat)
        amount=1 : +3 dB peak at 4 kHz
        """
        gain_db = amount * 3.0   # 0 dB → +3 dB
        return self._a.peak_eq(4000, gain_db, 1.0)

    def harshness(self, amount: float = 1.0) -> "AudioFile":
        """
        Cut the 4–8 kHz range to tame brittle cymbals or a harsh mic.

        Reduces ear fatigue from over-bright overheads or room mics
        by dipping the presence region centered at 6 kHz.

        amount=0 : no cut (flat)
        amount=1 : −2.5 dB dip at 6 kHz
        """
        gain_db = -amount * 2.5   # 0 dB → −2.5 dB
        return self._a.peak_eq(6000, gain_db, 1.0)

    def air(self, amount: float = 1.0) -> "AudioFile":
        """
        High-shelf boost above 10 kHz for openness and spatial shimmer.

        Adds the "air" that makes recordings feel live and three-dimensional
        without brightening the midrange.

        amount=0 : no boost (flat)
        amount=1 : +3 dB high shelf at 10 kHz
        """
        gain_db = amount * 3.0   # 0 dB → +3 dB
        return self._a.high_shelf(10000, gain_db)

    def brightness(self, amount: float = 1.0) -> "AudioFile":
        """
        High-shelf tilt above 8 kHz to shift the overall tone lighter or darker.

        Positive amounts make the kit brighter and more present; negative
        values below 0 darken and warm it instead.

        amount=0 : no change (flat)
        amount=1 : +2 dB high shelf at 8 kHz
        """
        gain_db = amount * 2.0   # 0 dB → +2 dB
        return self._a.high_shelf(8000, gain_db)

    def resonance(self, amount: float = 1.0) -> "AudioFile":
        """
        Auto-detect and notch up to five narrow resonant peaks between 80–8000 Hz.

        Finds frequencies where the room or kit rings unnaturally and cuts
        them with a tight notch filter. Higher amount uses a narrower (more
        surgical) notch Q.

        amount=0 : Q = 0 — peaks untouched
        amount=1 : Q = 30 — tight, surgical notch at each detected resonance
        """
        mono = self._a.data.mean(axis=1)
        fft_mag = np.abs(np.fft.rfft(mono))
        freqs = np.fft.rfftfreq(len(mono), 1.0 / self._a.sample_rate)
        window = min(51, len(fft_mag) // 4 * 2 + 1)   # savgol needs odd window
        smoothed = savgol_filter(fft_mag, window, 3)
        peaks, _ = find_peaks(smoothed, height=np.percentile(smoothed, 95), distance=50)
        notch_q = amount * 30.0   # Q=0 → Q=30
        for idx in peaks[:5]:
            freq = freqs[idx]
            if 80 < freq < 8000:
                self._a.notch(freq, q=notch_q)
        return self._a

    # --- Dynamics ---

    def dynamic_range(self, amount: float = 1.0) -> "AudioFile":
        """
        Compression to balance the volume difference between quiet and loud hits.

        Reduces the gap between the softest ghost notes and the hardest
        accents so the kit sits more evenly in the mix.

        amount=0 : 1:1 ratio (no compression, bypass)
        amount=1 : 4:1 ratio — noticeable but musical gain reduction
        """
        import pedalboard
        ratio = 1.0 + amount * 3.0   # 1:1 → 4:1
        return self._pb(pedalboard.Compressor(
            threshold_db=-18, ratio=ratio, attack_ms=10, release_ms=100,
        ))

    def punch(self, amount: float = 1.0) -> "AudioFile":
        """
        Slow-attack compression that lets transients through before clamping.

        The slow attack gives drum hits a brief window to "punch" before
        compression kicks in, accentuating the initial crack of each stroke.

        amount=0 : 1:1 ratio and 0 ms attack (bypass)
        amount=1 : 3:1 ratio with 30 ms attack — maximum transient punch
        """
        import pedalboard
        ratio     = 1.0 + amount * 2.0   # 1:1 → 3:1
        attack_ms = amount * 30.0         # 0 ms → 30 ms
        return self._pb(pedalboard.Compressor(
            threshold_db=-20, ratio=ratio, attack_ms=attack_ms, release_ms=80,
        ))

    def sustain(self, amount: float = 1.0) -> "AudioFile":
        """
        Noise gate to control how long drum tails ring out after each hit.

        Cuts the signal once it falls below the threshold, tightening the
        room decay and preventing bleed between hits.

        amount=0 : 1:1 ratio (no gating, drums ring freely)
        amount=1 : 3:1 gate ratio — tails cut off more aggressively
        """
        import pedalboard
        ratio = 1.0 + amount * 2.0   # 1:1 → 3:1
        return self._pb(pedalboard.NoiseGate(
            threshold_db=-40, ratio=ratio, attack_ms=1.0, release_ms=100,
        ))

    def consistency(self, amount: float = 1.0) -> "AudioFile":
        """
        Fast-attack compression to keep every hit at a similar volume level.

        Prevents individual drum hits from jumping out or disappearing in
        the mix by quickly catching gain outliers.

        amount=0 : 1:1 ratio (no compression, bypass)
        amount=1 : 2:1 ratio with 5 ms attack / 50 ms release
        """
        import pedalboard
        ratio = 1.0 + amount * 1.0   # 1:1 → 2:1
        return self._pb(pedalboard.Compressor(
            threshold_db=-12, ratio=ratio, attack_ms=5, release_ms=50,
        ))

    def pumping(self, amount: float = 1.0) -> "AudioFile":
        """
        Long-release compression to smooth unnatural volume breathing.

        "Pumping" is the audible in-and-out swell caused by fast-release
        compressors. Increasing amount lengthens the release so the gain
        envelope moves more naturally.

        amount=0 : 1:1 ratio (bypass — no anti-pumping treatment)
        amount=1 : 2:1 ratio with 500 ms release — smoothest envelope
        """
        import pedalboard
        ratio      = 1.0 + amount * 1.0   # 1:1 → 2:1
        release_ms = 100 + amount * 400   # 100 ms → 500 ms
        return self._pb(pedalboard.Compressor(
            threshold_db=-18, ratio=ratio, attack_ms=10, release_ms=release_ms,
        ))

    # --- Room / Spatial ---

    def roominess(self, amount: float = 1.0) -> "AudioFile":
        """
        Reduce excessive room reflections via non-stationary spectral gating.

        Attenuates the reverberant wash between hits so the kit sounds
        drier and more present, without touching the hits themselves.

        amount=0 : no room reduction applied
        amount=1 : full room reduction — reflections suppressed as much as possible
        """
        import noisereduce as nr
        prop_decrease = amount   # 0.0 → 1.0
        for ch in range(self._a.data.shape[1]):
            self._a.data[:, ch] = nr.reduce_noise(
                y=self._a.data[:, ch],
                sr=self._a.sample_rate,
                stationary=False,
                prop_decrease=prop_decrease,
            )
        return self._a

    def width(self, amount: float = 1.0) -> "AudioFile":
        """
        Mid-side stereo widening — no-op on mono files.

        Increases the side (difference) signal relative to the mid (sum)
        signal, making the kit feel wider and more immersive in stereo.

        amount=0 : no widening (original stereo image unchanged)
        amount=1 : side signal doubled — noticeably wider stereo field
        """
        if self._a.data.shape[1] < 2:
            return self._a
        L, R = self._a.data[:, 0], self._a.data[:, 1]
        M = (L + R) / 2
        S = (L - R) / 2 * (1 + amount)   # side gain: 1× at 0, 2× at 1
        self._a.data[:, 0] = M + S
        self._a.data[:, 1] = M - S
        return self._a

    def depth(self, amount: float = 1.0) -> "AudioFile":
        """
        Add perceived distance via a subtle reverb blend.

        Places the kit further back in the mix by blending in a small
        reverb tail without washing out the transients.

        amount=0 : dry signal only (no reverb)
        amount=1 : small room reverb at 15% wet — present but not washy
        """
        import pedalboard
        room_size = amount * 0.3    # 0.0 → 0.3
        wet_level = amount * 0.15   # 0.0 → 0.15
        return self._pb(pedalboard.Reverb(
            room_size=room_size, damping=0.7,
            wet_level=wet_level, dry_level=1.0,
        ))

    # --- Artifacts ---

    def clipping(self, amount: float = 1.0) -> "AudioFile":
        """
        Soft-knee tanh limiter to reduce the harshness of existing clipping.

        Applies gentle wave-shaping to hard-clipped peaks, rounding their
        edges so the distortion sounds less brittle and aggressive.

        amount=0 : drive = 1 (minimal wave-shaping, near-transparent)
        amount=1 : drive = 2 — noticeable softening of clipped transients
        """
        drive = 1.0 + amount   # 1.0 → 2.0
        self._a.data = np.tanh(self._a.data * drive) / drive
        return self._a

    # --- Harmonic ---

    def warmth(self, amount: float = 1.0) -> "AudioFile":
        """
        Soft tanh saturation for tape or tube-style fullness and character.

        Introduces gentle even-order harmonics across the whole signal,
        lending analogue-style density and rounding sharp digital edges.

        amount=0 : drive = 1 (transparent — near-bypass for normal levels)
        amount=1 : drive = 3 — clear saturation with noticeable harmonic colour
        """
        drive = 1.0 + amount * 2.0   # 1.0 → 3.0
        self._a.data = np.tanh(self._a.data * drive) / drive
        return self._a

    def presence(self, amount: float = 1.0) -> "AudioFile":
        """
        Harmonic excitation in the 2–8 kHz band to help drums cut through a mix.

        Extracts the mid-high band, saturates it lightly, and blends the
        resulting upper harmonics back into the signal — adding sheen and
        definition without a simple EQ boost.

        amount=0 : no harmonics added (fully dry)
        amount=1 : full harmonic blend at 30% — kit cuts through clearly
        """
        sos = butter(4, [2000, 8000], btype="band", fs=self._a.sample_rate, output="sos")
        band = sosfiltfilt(sos, self._a.data, axis=0)
        drive     = 1.0 + amount          # 1.0 → 2.0
        harmonics = np.tanh(band * drive) / drive - band
        blend     = amount * 0.3          # 0.0 → 0.3
        self._a.data = self._a.data + harmonics * blend
        return self._a

    # --- Perceptual ---

    def fullness(self, amount: float = 1.0) -> "AudioFile":
        """
        Preserve low-mids and add mild saturation for a dense, full-bodied sound.

        Combines a gentle 200 Hz lift with soft drive to make the kit
        feel thick without over-filtering or dramatically changing the tone.

        amount=0 : no boost and no saturation (bypass)
        amount=1 : +1.5 dB at 200 Hz plus light saturation at drive = 1.5
        """
        low_mid_gain_db = amount * 1.5       # 0 dB → +1.5 dB
        drive           = 1.0 + amount * 0.5  # 1.0 → 1.5
        self._a.peak_eq(200, low_mid_gain_db, 1.5)
        self._a.data = np.tanh(self._a.data * drive) / drive
        return self._a

    def naturalness(self, amount: float = 1.0) -> "AudioFile":
        """
        Brick-wall limiter to guard against over-processing artifacts.

        Clamps any peaks that exceed −3 dBFS, catching distortion or
        clipping introduced by heavy upstream processing so the output
        stays clean regardless of the processing chain applied before it.

        amount=0 : 1:1 ratio (no limiting, fully transparent)
        amount=1 : 20:1 hard-limiting at −3 dBFS
        """
        import pedalboard
        ratio = 1.0 + amount * 19.0   # 1:1 → 20:1
        return self._pb(pedalboard.Compressor(
            threshold_db=-3, ratio=ratio, attack_ms=0.1, release_ms=50,
        ))
