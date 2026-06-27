# Blanket Inference API

Listens to an audio file with one of three audio models — **AST**, **BEATs**, or
**CLAP** — and suggests an `amount` (0–1) for every *blanket term*: the
high-level perceptual controls defined on `functions/blanket.py::Blanket`
(`kick_presence`, `denoise`, `warmth`, `roominess`, …).

The output is a list in the exact blanket-term format, so it drops straight back
into the blanket API to process the audio.

```
audio file ──▶ model (ast | beats | clap) ──▶ [{"term", "amount"}, ...] ──▶ blanket
```

---

## Contents

| Path | Purpose |
|---|---|
| `inference.py` | Inference logic: the 3 backends + the mapping from model output → amounts. |
| `api.py` | FastAPI HTTP layer (upload audio, get suggestions). |
| `config.py` | Settings, loaded from the environment / `.env`. |
| `.env.example` | Template env file — copy to `.env`. |
| `requirements.txt` | Python dependencies. |
| `beats/` | Bundled BEATs model code + AudioSet label CSV. |
| `checkpoints/` | BEATs `.pt` checkpoint(s). |
| `../test_inference.py` | Standalone script that runs a model on a local file. |

---

## How it works

Each backend produces a `{blanket_term: amount}` map, which is returned as an
ordered list.

- **AST** and **BEATs** are AudioSet *taggers*: they emit a probability for each
  of 527 AudioSet sound classes. Those probabilities are folded into blanket
  amounts using the curated `AUDIOSET_RULES` table in `inference.py`
  (e.g. a high `Noise` probability raises `denoise`; `Reverberation` raises
  `roominess`; `Bass drum` raises `kick_presence`).
- **CLAP** is *contrastive* (audio ↔ text). For each blanket term it scores the
  audio against a natural-language description of when that treatment is wanted
  (from [`PROMPT.md`](PROMPT.md)), then normalizes those similarities into amounts.
- `BASELINE_AMOUNTS` adds gentle always-on values (e.g. a touch of
  `naturalness`) regardless of content.

> AST and BEATs suggestions are only as good as `AUDIOSET_RULES`. Those are
> sensible defaults, not tuned to any particular source material — expect to
> adjust the weights. CLAP needs no rule table but is fuzzier.

---

## Setup

```bash
# from the timber/ project root
pip install -r inference/requirements.txt        # or use the bundled .venv
cp inference/.env.example inference/.env          # then edit if needed
```

Model availability:

- **AST** and **CLAP** download automatically from the Hugging Face Hub on first
  use (cached in `~/.cache/huggingface`). No setup needed.
- **BEATs** is fully bundled: code in `beats/`, label map in
  `beats/class_labels_indices.csv`, checkpoint in `checkpoints/`, and
  `BEATS_CHECKPOINT` already set in `.env`. It also needs `torchaudio` matching
  your installed `torch` build (see Troubleshooting).

### Using the bundled venv

A `.venv` already exists at the project root with everything installed. Use it
directly:

```bash
.venv/bin/python ...
.venv/bin/uvicorn ...
```

---

## Usage

There are three ways to use it: the test script, the HTTP API, or the Python
library.

### 1. Test script (quickest)

Runs a model on one local file and prints the suggestions. No server.

```bash
cd timber
.venv/bin/python test_inference.py            # default model: clap
.venv/bin/python test_inference.py ast        # or: beats
```

The script handles non-audio containers (it extracts the audio track from the
configured `.mov` with ffmpeg first). Change the `SOURCE` path at the top of
`test_inference.py` to point at your own file.

### 2. HTTP API

Start the server:

```bash
cd timber
.venv/bin/uvicorn inference.api:app --port 8000
# or: .venv/bin/python -m inference.api
```

Endpoints:

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness, available models, device. |
| `GET` | `/terms` | The canonical list of blanket terms. |
| `POST` | `/suggest?model=<ast\|beats\|clap>` | Upload audio, get suggestions. |

Interactive docs (Swagger UI) are at `http://localhost:8000/docs`.

Example:

```bash
curl -F "file=@drums.wav" "http://localhost:8000/suggest?model=clap"

# steer it: append context to every CLAP prompt and start from the user's
# current sliders (blended 50/50 on terms they set, model-only elsewhere)
curl -F "file=@drums.wav" \
     -F "context=live drum kit, noisy room" \
     -F 'inclination={"warmth":0.6,"denoise":0.2}' \
     "http://localhost:8000/suggest?model=clap"
```

`model` is optional; it defaults to `DEFAULT_MODEL` in `.env` (`clap`).
Two optional form fields steer the result: `context` (free-text appended to
every CLAP prompt — CLAP only) and `inclination` (a JSON `{term: value}` map of
the caller's current values, blended into the suggestions).
Accepted uploads: `.wav .flac .ogg .aiff .aif .mp3` (libsndfile-readable
formats). For video/other containers, extract the audio first.

Response:

```json
{
  "model": "clap",
  "filename": "drums.wav",
  "suggestions": [
    {"term": "high_pass_rumble", "amount": 0.62},
    {"term": "denoise",          "amount": 0.30},
    {"term": "kick_presence",    "amount": 0.45}
  ]
}
```

### 3. Python library

Call the logic directly, skipping HTTP:

```python
from inference import suggest_blanket_amounts

suggestions = suggest_blanket_amounts("drums.wav", model="ast")
# -> [{"term": "high_pass_rumble", "amount": 0.62}, ...]
```

---

## Applying the suggestions

The `suggestions` list maps 1:1 onto the blanket methods, so you can apply them
in a loop:

```python
from functions import AudioFile
from inference import suggest_blanket_amounts

audio = AudioFile("drums.wav")
for s in suggest_blanket_amounts("drums.wav", model="clap"):
    getattr(audio.blanket, s["term"])(s["amount"])
audio.save("drums_processed.wav")
```

---

## Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `AST_MODEL_ID` | `MIT/ast-finetuned-audioset-10-10-0.4593` | AST model on HF Hub. |
| `CLAP_MODEL_ID` | `laion/clap-htsat-unfused` | CLAP model on HF Hub. |
| `BEATS_CHECKPOINT` | *(set)* | Absolute path to the BEATs `.pt`. |
| `BEATS_CODE_DIR` | `inference/beats` | Dir with BEATs model code. |
| `BEATS_LABELS_CSV` | `inference/beats/class_labels_indices.csv` | AudioSet id→name map. |
| `HF_HOME` | *(unset)* | HF cache dir. |
| `HUGGING_FACE_HUB_TOKEN` | *(unset)* | Token for gated/private models or higher rate limits. |
| `DEVICE` | `auto` | `auto` \| `cuda` \| `cpu`. |
| `DEFAULT_MODEL` | `clap` | Model used when `?model=` is omitted. |
| `API_HOST` / `API_PORT` | `0.0.0.0` / `8000` | Server bind address. |
| `MAX_UPLOAD_MB` | `50` | Reject larger uploads. |

---

## Tuning

The mapping from model output to amounts lives at the top of `inference.py`:

- `BLANKET_TERMS` — the canonical term list (keep in sync with `blanket.py`).
- `AUDIOSET_RULES` — `AudioSet tag substring → [(term, weight), ...]` for AST/BEATs.
- `BASELINE_AMOUNTS` — gentle always-on amounts.

The per-term CLAP prompts live in [`PROMPT.md`](PROMPT.md) (one `term: prompt`
per line), loaded into `CLAP_PROMPTS` at import.

To make AST/BEATs more useful for your material, add or reweight entries in
`AUDIOSET_RULES`. To steer CLAP, edit `PROMPT.md` so each prompt describes the
*condition that warrants* that treatment, or pass `context` per request to
append shared free-text to every prompt without editing the file.

---

## Troubleshooting

**`torchaudio` `OSError: undefined symbol ...` / ABI mismatch.** torchaudio must
match the exact `torch` build. Install the matching wheel, e.g.:

```bash
.venv/bin/pip install --no-deps "torchaudio==<your torch version>" \
  --index-url https://download.pytorch.org/whl/cu128
```

**`BEATs model code not found`.** `BEATS_CODE_DIR` must contain `BEATs.py`,
`backbone.py`, `modules.py`. The bundled `beats/` folder has them.

**`BEATS_CHECKPOINT is not set`.** Set it in `.env` to the absolute `.pt` path.

**`soundfile`/libsndfile can't read the file.** It's likely a video or
compressed container. Extract audio first:
`ffmpeg -i input.mov -vn -ac 1 -ar 48000 out.wav`.

**First request is slow.** AST/CLAP weights download on first use, then cache.

**HF rate-limit / unauthenticated warning.** Harmless; set
`HUGGING_FACE_HUB_TOKEN` in `.env` to silence it and get faster downloads.

---

## Choosing a model

| Model | Type | Strengths | Notes |
|---|---|---|---|
| **CLAP** | Audio↔text | No rule table; flexible via prompts | Default; fuzzier amounts |
| **AST** | AudioSet tagger | Strong, well-known tagger | Needs `AUDIOSET_RULES` tuning |
| **BEATs** | AudioSet tagger | SOTA tagging accuracy | Bundled; needs `torchaudio` |
