# Timber

Multi-track audio/video editor. A React Native (Expo) app applies "Blanket"
perceptual audio controls per track; a Python inference service suggests Blanket
amounts by listening to the audio. The app's "AI suggestions" call the local
inference API — not a hosted LLM.

## Layout

- `mobile/` — Expo app. Runs as web, Electron desktop, or iOS.
- `inference/` — FastAPI service: audio file → suggested Blanket amounts (AST / BEATs / CLAP).
- `functions/` — audio-processing primitives (`blanket.py`, `audiofile.py`).
- `hub/` — local Hugging Face model caches.
- `DESIGN.md` — recording, multi-track model, and platform-handler architecture.

## Run the app

```bash
cd mobile
npm install
npm run win:web        # browser
npm run win:electron   # Windows desktop (Electron); run on the Windows host
npm run apple          # iOS (macOS)
```

Electron must run on the Windows host (not WSL) to capture Windows system audio.

## Run the inference API

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn inference.api:app --reload --port 8000
```

Serves `/health`, `/terms`, `/suggest` on `http://localhost:8000`.
