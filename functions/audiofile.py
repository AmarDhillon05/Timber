import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfiltfilt, iirnotch, tf2sos
from .blanket import Blanket


class AudioFile:
    def __init__(self, path: str):
        self.data, self.sample_rate = sf.read(path, always_2d=True)
        self.path = path
        self.blanket = Blanket(self)

    def save(self, path: str = None) -> "AudioFile":
        sf.write(path or self.path, self.data, self.sample_rate)
        return self

    # --- Filters ---

    def high_pass(self, cutoff_hz: float, order: int = 4) -> "AudioFile":
        sos = butter(order, cutoff_hz, btype="high", fs=self.sample_rate, output="sos")
        self.data = sosfiltfilt(sos, self.data, axis=0)
        return self

    def low_pass(self, cutoff_hz: float, order: int = 4) -> "AudioFile":
        sos = butter(order, cutoff_hz, btype="low", fs=self.sample_rate, output="sos")
        self.data = sosfiltfilt(sos, self.data, axis=0)
        return self

    def band_pass(self, low_hz: float, high_hz: float, order: int = 4) -> "AudioFile":
        sos = butter(order, [low_hz, high_hz], btype="band", fs=self.sample_rate, output="sos")
        self.data = sosfiltfilt(sos, self.data, axis=0)
        return self

    def notch(self, center_hz: float, q: float = 30.0) -> "AudioFile":
        """Narrow cut at a specific frequency. Higher Q = narrower."""
        b, a = iirnotch(center_hz, q, self.sample_rate)
        sos = tf2sos(b, a)
        self.data = sosfiltfilt(sos, self.data, axis=0)
        return self

    # --- Parametric / Shelving EQ (Audio EQ Cookbook biquads) ---

    def peak_eq(self, center_hz: float, gain_db: float, q: float) -> "AudioFile":
        """Boost or cut a frequency band. Negative gain_db cuts."""
        A = 10 ** (gain_db / 40)
        w0 = 2 * np.pi * center_hz / self.sample_rate
        alpha = np.sin(w0) / (2 * q)
        b = np.array([1 + alpha * A, -2 * np.cos(w0), 1 - alpha * A])
        a = np.array([1 + alpha / A, -2 * np.cos(w0), 1 - alpha / A])
        self.data = sosfiltfilt(tf2sos(b, a), self.data, axis=0)
        return self

    def low_shelf(self, cutoff_hz: float, gain_db: float, slope: float = 1.0) -> "AudioFile":
        """Boost or cut all frequencies below cutoff_hz."""
        A = 10 ** (gain_db / 40)
        w0 = 2 * np.pi * cutoff_hz / self.sample_rate
        alpha = np.sin(w0) / 2 * np.sqrt((A + 1 / A) * (1 / slope - 1) + 2)
        cos_w0 = np.cos(w0)
        sqrt_A = np.sqrt(A)
        b = np.array([
            A * ((A + 1) - (A - 1) * cos_w0 + 2 * sqrt_A * alpha),
            2 * A * ((A - 1) - (A + 1) * cos_w0),
            A * ((A + 1) - (A - 1) * cos_w0 - 2 * sqrt_A * alpha),
        ])
        a = np.array([
            (A + 1) + (A - 1) * cos_w0 + 2 * sqrt_A * alpha,
            -2 * ((A - 1) + (A + 1) * cos_w0),
            (A + 1) + (A - 1) * cos_w0 - 2 * sqrt_A * alpha,
        ])
        self.data = sosfiltfilt(tf2sos(b, a), self.data, axis=0)
        return self

    def high_shelf(self, cutoff_hz: float, gain_db: float, slope: float = 1.0) -> "AudioFile":
        """Boost or cut all frequencies above cutoff_hz."""
        A = 10 ** (gain_db / 40)
        w0 = 2 * np.pi * cutoff_hz / self.sample_rate
        alpha = np.sin(w0) / 2 * np.sqrt((A + 1 / A) * (1 / slope - 1) + 2)
        cos_w0 = np.cos(w0)
        sqrt_A = np.sqrt(A)
        b = np.array([
            A * ((A + 1) + (A - 1) * cos_w0 + 2 * sqrt_A * alpha),
            -2 * A * ((A - 1) + (A + 1) * cos_w0),
            A * ((A + 1) + (A - 1) * cos_w0 - 2 * sqrt_A * alpha),
        ])
        a = np.array([
            (A + 1) - (A - 1) * cos_w0 + 2 * sqrt_A * alpha,
            2 * ((A - 1) - (A + 1) * cos_w0),
            (A + 1) - (A - 1) * cos_w0 - 2 * sqrt_A * alpha,
        ])
        self.data = sosfiltfilt(tf2sos(b, a), self.data, axis=0)
        return self

    # --- Gain ---

    def gain(self, db: float) -> "AudioFile":
        self.data = self.data * (10 ** (db / 20))
        return self
