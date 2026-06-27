"""
inference.py — suggest `amount` values for every blanket term from an audio file.

A "blanket term" is one of the high-level perceptual controls defined on
`functions/blanket.py::Blanket`. Each is a method that takes `amount: float`
in [0, 1] (0 = no effect, 1 = standard treatment). This module listens to an
audio file with one of three audio models and proposes an `amount` for each
term, returning a list in exactly that format:

    [
        {"term": "high_pass_rumble", "amount": 0.62},
        {"term": "denoise",          "amount": 0.30},
        ...
    ]

That list can be fed straight back into the blanket API:

    for s in suggestions:
        getattr(audio.blanket, s["term"])(s["amount"])

Three backends are supported (pick one per request):
  - "ast"   Audio Spectrogram Transformer (HF, AudioSet tags)
  - "beats" Microsoft BEATs              (checkpoint, AudioSet tags)
  - "clap"  CLAP                          (HF, zero-shot text similarity)

AST and BEATs are AudioSet taggers: they emit a probability per AudioSet class,
which we fold into per-term amounts with the curated rules in AUDIOSET_RULES.
CLAP is contrastive (audio<->text), so it scores each term directly against a
natural-language description of when that treatment is wanted (CLAP_PROMPTS).
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

from .config import settings


# --------------------------------------------------------------------------
# Canonical blanket terms (must stay in sync with functions/blanket.py)
# --------------------------------------------------------------------------

# Order matches the sections in functions/blanket.py / audio_objectives.md.
BLANKET_TERMS: Tuple[str, ...] = (
    # EQ / Frequency
    "high_pass_rumble",
    "denoise",
    "kick_presence",
    "snare_body",
    "boxiness",
    "attack",
    "harshness",
    "air",
    "brightness",
    "resonance",
    # Dynamics
    "dynamic_range",
    "punch",
    "sustain",
    "consistency",
    "pumping",
    # Room / Spatial
    "roominess",
    "width",
    "depth",
    # Artifacts
    "clipping",
    # Harmonic
    "warmth",
    "presence",
    "fullness",
    # Perceptual
    "naturalness",
)


@dataclass
class Suggestion:
    term: str
    amount: float

    def as_dict(self) -> Dict[str, float]:
        return {"term": self.term, "amount": round(float(self.amount), 4)}


# --------------------------------------------------------------------------
# Rule tables
# --------------------------------------------------------------------------

# AudioSet-tag -> blanket-term rules for the tagging backends (AST, BEATs).
#
# Each entry maps a lowercase substring matched against AudioSet class names to
# a list of (term, weight) contributions. The probability of every matching
# class is multiplied by its weight and summed per term, then squashed to
# [0, 1]. Weights are heuristic starting points — tune them for your material.
#
# Intuition: detect what is *wrong* (noise, hum, reverb, distortion) and ask for
# corrective treatment; detect what the kit *is* and nudge tonal shaping.
AUDIOSET_RULES: Dict[str, List[Tuple[str, float]]] = {
    # --- problems that call for clean-up ---
    "noise":          [("denoise", 0.9), ("high_pass_rumble", 0.3)],
    "static":         [("denoise", 0.8)],
    "hiss":           [("denoise", 0.7), ("air", -0.3)],
    "hum":            [("denoise", 0.5), ("high_pass_rumble", 0.6), ("resonance", 0.6)],
    "mains hum":      [("high_pass_rumble", 0.7), ("resonance", 0.7)],
    "rumble":         [("high_pass_rumble", 0.9)],
    "wind":           [("high_pass_rumble", 0.7), ("denoise", 0.5)],
    "vibration":      [("high_pass_rumble", 0.5)],
    "echo":           [("roominess", 0.8), ("depth", -0.3)],
    "reverberation":  [("roominess", 0.9), ("depth", -0.4)],
    "inside, large room or hall": [("roominess", 0.7)],
    "distortion":     [("clipping", 0.9), ("naturalness", 0.5), ("harshness", 0.4)],
    "clipping":       [("clipping", 1.0), ("naturalness", 0.6)],
    # --- it's a drum kit: tonal shaping ---
    "drum kit":       [("punch", 0.5), ("attack", 0.4), ("kick_presence", 0.3)],
    "drum":           [("punch", 0.4), ("attack", 0.3)],
    "bass drum":      [("kick_presence", 0.6), ("fullness", 0.3)],
    "snare drum":     [("snare_body", 0.6), ("attack", 0.3)],
    "cymbal":         [("harshness", 0.4), ("air", 0.3)],
    "hi-hat":         [("attack", 0.4), ("harshness", 0.3)],
    "tom":            [("snare_body", 0.3), ("boxiness", 0.3)],
    "percussion":     [("punch", 0.3), ("attack", 0.3)],
    # --- general musical material ---
    "music":          [("warmth", 0.3), ("presence", 0.3), ("dynamic_range", 0.3)],
}

# Amounts every backend applies regardless of content. These are gentle,
# always-on guards that match the spirit of the blanket defaults.
BASELINE_AMOUNTS: Dict[str, float] = {
    "naturalness": 0.25,   # always keep a soft brick-wall guard
    "high_pass_rumble": 0.2,
}

# CLAP zero-shot prompts: a natural-language description of *when this treatment
# is warranted*. CLAP scores the audio against each and the similarity becomes
# the amount. Phrase prompts as the condition the term corrects/adds.
#
# The canonical prompts live in PROMPT.md (one `term: prompt` per line) so they
# can be edited without touching code. Callers may layer extra context on top of
# these per request (see `_build_clap_prompts`).
PROMPT_FILE = os.path.join(os.path.dirname(__file__), "PROMPT.md")


def load_clap_prompts(path: str = PROMPT_FILE) -> Dict[str, str]:
    """Parse the canonical per-term CLAP prompts from PROMPT.md.

    Each line of the form `term: prompt text` whose term is a known blanket
    term becomes that term's prompt. Markdown headings (`#…`) and blank lines
    are ignored. Prompts never contain a colon, so splitting on the first one
    is safe.
    """
    terms = set(BLANKET_TERMS)
    prompts: Dict[str, str] = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or ":" not in line:
                continue
            key, _, value = line.partition(":")
            key = key.strip().strip("`*-").strip()
            value = value.strip()
            if key in terms and value:
                prompts[key] = value
    return prompts


CLAP_PROMPTS: Dict[str, str] = load_clap_prompts()


def _build_clap_prompts(context: str | None = None) -> Dict[str, str]:
    """The canonical prompts, optionally with shared free-text appended.

    `context` is a single phrase from the caller (e.g. "live drum kit, noisy
    room"). When present it is appended to every term's prompt so it biases all
    of the CLAP scores at once, without replacing the curated descriptions.
    """
    ctx = (context or "").strip()
    if not ctx:
        return CLAP_PROMPTS
    return {term: f"{prompt}. {ctx}" for term, prompt in CLAP_PROMPTS.items()}


# --------------------------------------------------------------------------
# Audio loading helpers
# --------------------------------------------------------------------------

def load_audio(path: str, target_sr: int) -> np.ndarray:
    """Load an audio file as a mono float32 waveform at target_sr."""
    data, sr = sf.read(path, always_2d=True)
    mono = data.mean(axis=1).astype(np.float64)
    if sr != target_sr:
        g = math.gcd(int(sr), int(target_sr))
        mono = resample_poly(mono, target_sr // g, sr // g)
    return mono.astype(np.float32)


def _squash(x: float) -> float:
    """Map an unbounded non-negative score into [0, 1]."""
    return float(max(0.0, min(1.0, x)))


def _tags_to_amounts(tag_scores: Dict[str, float]) -> Dict[str, float]:
    """Fold AudioSet tag probabilities into per-term amounts via AUDIOSET_RULES."""
    amounts: Dict[str, float] = {t: 0.0 for t in BLANKET_TERMS}
    for term, base in BASELINE_AMOUNTS.items():
        amounts[term] = base

    for label, prob in tag_scores.items():
        label_l = label.lower()
        for needle, rules in AUDIOSET_RULES.items():
            if needle in label_l:
                for term, weight in rules:
                    amounts[term] += prob * weight

    return {t: _squash(v) for t, v in amounts.items()}


# --------------------------------------------------------------------------
# Backends
# --------------------------------------------------------------------------

class _ASTBackend:
    """Audio Spectrogram Transformer -> AudioSet tags -> amounts."""

    SR = 16_000

    def __init__(self) -> None:
        import torch
        from transformers import ASTForAudioClassification, AutoFeatureExtractor

        self._torch = torch
        self._fe = AutoFeatureExtractor.from_pretrained(settings.ast_model_id)
        self._model = ASTForAudioClassification.from_pretrained(settings.ast_model_id)
        self._model.eval().to(settings.device)

    def suggest(self, path: str) -> Dict[str, float]:
        wav = load_audio(path, self.SR)
        inputs = self._fe(wav, sampling_rate=self.SR, return_tensors="pt")
        inputs = {k: v.to(settings.device) for k, v in inputs.items()}
        with self._torch.no_grad():
            logits = self._model(**inputs).logits[0]
        probs = self._torch.sigmoid(logits).cpu().numpy()
        id2label = self._model.config.id2label
        tag_scores = {id2label[i]: float(p) for i, p in enumerate(probs)}
        return _tags_to_amounts(tag_scores)


class _BEATsBackend:
    """Microsoft BEATs -> AudioSet tags -> amounts.

    BEATs is not packaged on the HF Hub as a ready pipeline; it ships as a
    checkpoint plus the model code in microsoft/unilm (the `BEATs` module).
    Point BEATS_CHECKPOINT at the .pt file and make the `BEATs` module
    importable (clone unilm/beats onto PYTHONPATH).
    """

    SR = 16_000

    def __init__(self) -> None:
        import csv
        import os
        import sys

        import torch

        # The BEATs code uses flat imports (`from backbone import ...`), so its
        # directory must be on sys.path directly (not imported as a package).
        code_dir = settings.beats_code_dir
        if code_dir and code_dir not in sys.path:
            sys.path.insert(0, code_dir)

        try:
            from BEATs import BEATs, BEATsConfig  # type: ignore
        except ImportError as e:  # pragma: no cover - depends on user setup
            raise ImportError(
                f"BEATs model code not found in {code_dir!r}. Set BEATS_CODE_DIR "
                "to a directory containing BEATs.py, backbone.py, modules.py."
            ) from e

        if not settings.beats_checkpoint:
            raise ValueError("BEATS_CHECKPOINT is not set in the environment.")

        self._torch = torch
        ckpt = torch.load(settings.beats_checkpoint, map_location="cpu", weights_only=False)
        cfg = BEATsConfig(ckpt["cfg"])
        self._model = BEATs(cfg)
        self._model.load_state_dict(ckpt["model"])
        self._model.eval().to(settings.device)
        # checkpoint label_dict maps model output index -> AudioSet mid (e.g. /m/09x0r)
        self._label_dict = ckpt.get("label_dict", {})

        # mid -> human-readable display name, so AUDIOSET_RULES can match.
        self._mid2name: Dict[str, str] = {}
        if os.path.exists(settings.beats_labels_csv):
            with open(settings.beats_labels_csv, newline="") as f:
                for row in csv.DictReader(f):
                    self._mid2name[row["mid"]] = row["display_name"]

    def suggest(self, path: str) -> Dict[str, float]:
        wav = load_audio(path, self.SR)
        x = self._torch.from_numpy(wav).unsqueeze(0).to(settings.device)
        padding_mask = self._torch.zeros(x.shape, dtype=self._torch.bool, device=settings.device)
        with self._torch.no_grad():
            probs = self._model.extract_features(x, padding_mask=padding_mask)[0][0]
        probs = probs.cpu().numpy()
        tag_scores: Dict[str, float] = {}
        for i, p in enumerate(probs):
            mid = self._label_dict.get(i)
            name = self._mid2name.get(mid, mid if mid is not None else str(i))
            tag_scores[name] = float(p)
        return _tags_to_amounts(tag_scores)


class _CLAPBackend:
    """CLAP zero-shot: score the audio against a text prompt per term."""

    SR = 48_000

    def __init__(self) -> None:
        import torch
        from transformers import ClapModel, ClapProcessor

        self._torch = torch
        self._model = ClapModel.from_pretrained(settings.clap_model_id)
        self._model.eval().to(settings.device)
        self._processor = ClapProcessor.from_pretrained(settings.clap_model_id)

    def suggest(self, path: str, prompts: Dict[str, str] | None = None) -> Dict[str, float]:
        # Prompts are resolved per request (model + weights stay cached, only
        # the cheap text encode reruns), so callers can layer in extra context.
        prompts = prompts or CLAP_PROMPTS
        terms = list(prompts.keys())
        prompt_list = [prompts[t] for t in terms]

        wav = load_audio(path, self.SR)
        try:
            inputs = self._processor(
                text=prompt_list,
                audio=[wav],
                sampling_rate=self.SR,
                return_tensors="pt",
                padding=True,
            )
        except (TypeError, ValueError):
            # transformers < 5 used the `audios` keyword.
            inputs = self._processor(
                text=prompt_list,
                audios=[wav],
                sampling_rate=self.SR,
                return_tensors="pt",
                padding=True,
            )
        inputs = {k: v.to(settings.device) for k, v in inputs.items()}
        with self._torch.no_grad():
            out = self._model(**inputs)
        # similarity of the single audio against every prompt
        sims = out.logits_per_audio[0]
        # min-max normalise across prompts so the strongest condition ~1.0
        sims = sims - sims.min()
        denom = sims.max()
        amounts_vec = (sims / denom) if denom > 0 else sims
        amounts_vec = amounts_vec.cpu().numpy()

        amounts = {t: 0.0 for t in BLANKET_TERMS}
        for term, base in BASELINE_AMOUNTS.items():
            amounts[term] = base
        for term, val in zip(terms, amounts_vec):
            amounts[term] = _squash(float(val))
        return amounts


_BACKENDS = {
    "ast": _ASTBackend,
    "beats": _BEATsBackend,
    "clap": _CLAPBackend,
}

# Simple process-wide cache so models load once.
_CACHE: Dict[str, object] = {}


def get_backend(model: str):
    model = model.lower().strip()
    if model not in _BACKENDS:
        raise ValueError(f"Unknown model {model!r}. Choose one of {list(_BACKENDS)}.")
    if model not in _CACHE:
        _CACHE[model] = _BACKENDS[model]()
    return _CACHE[model]


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------

def _blend_inclination(
    amounts: Dict[str, float],
    inclination: Dict[str, float],
    weight: float = 0.5,
) -> Dict[str, float]:
    """Pull the model's amounts toward the values the user already set.

    The user's current slider values are an "inclination": where they left a
    term at 0 (untouched) the model's amount is kept as is, so they still get
    fresh suggestions there. Where they set a non-zero value, the result is a
    `weight` blend of their value and the model's, clamped to [-1, 1] (sliders
    run -1..1, where negative is the opposite treatment direction).
    """
    blended = dict(amounts)
    for term, user_val in inclination.items():
        if term not in blended:
            continue
        user_val = float(user_val)
        if user_val == 0:
            continue
        mixed = weight * user_val + (1.0 - weight) * blended[term]
        blended[term] = max(-1.0, min(1.0, mixed))
    return blended


def suggest_blanket_amounts(
    path: str,
    model: str = "clap",
    context: str | None = None,
    inclination: Dict[str, float] | None = None,
) -> List[Dict[str, float]]:
    """Run inference and return a list of {"term", "amount"} in blanket order.

    The returned list is in the exact format of the blanket terms and ordered
    to match functions/blanket.py.

    `context` is free-text appended to every CLAP prompt to bias the scoring
    (CLAP only; ignored by the AudioSet taggers). `inclination` is the user's
    current per-term values, blended into the result so suggestions start from
    where they already are.
    """
    backend = get_backend(model)
    if isinstance(backend, _CLAPBackend):
        amounts = backend.suggest(path, prompts=_build_clap_prompts(context))
    else:
        amounts = backend.suggest(path)
    if inclination:
        amounts = _blend_inclination(amounts, inclination)
    return [Suggestion(term, amounts.get(term, 0.0)).as_dict() for term in BLANKET_TERMS]
