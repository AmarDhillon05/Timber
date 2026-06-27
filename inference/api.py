"""
api.py — HTTP API that suggests blanket-term amounts for an uploaded audio file.

Run locally:
    uvicorn inference.api:app --reload --port 8000
    # or:  python -m inference.api

Endpoints:
    GET  /health                 -> liveness + available models
    GET  /terms                  -> the canonical blanket-term list
    POST /suggest?model=clap     -> multipart upload, returns suggested amounts
                                    optional form fields:
                                      context     free-text appended to every
                                                  CLAP prompt (CLAP only)
                                      inclination JSON {term: value} of the
                                                  user's current sliders, blended
                                                  into the result

The /suggest response body is the list, in blanket-term format:
    {
      "model": "clap",
      "suggestions": [
        {"term": "high_pass_rumble", "amount": 0.62},
        {"term": "denoise",          "amount": 0.30},
        ...
      ]
    }
"""

from __future__ import annotations

import json
import os
import tempfile

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .inference import BLANKET_TERMS, suggest_blanket_amounts

app = FastAPI(
    title="Timber Blanket Inference API",
    description="Suggest amount values for each blanket term using AST, BEATs, or CLAP.",
    version="1.0.0",
)

# Allow the Expo web client (and other local dev origins) to call this from a
# browser. Permissive for local development — tighten allow_origins before
# exposing the API beyond localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

AVAILABLE_MODELS = ["ast", "beats", "clap"]
_ALLOWED_SUFFIXES = (".wav", ".flac", ".ogg", ".aiff", ".aif", ".mp3")


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "models": AVAILABLE_MODELS,
        "default_model": settings.default_model,
        "device": settings.device,
    }


@app.get("/terms")
def terms() -> dict:
    return {"terms": list(BLANKET_TERMS)}


@app.post("/suggest")
async def suggest(
    file: UploadFile = File(...),
    model: str = Query(
        default=None,
        description="Inference model to use: ast | beats | clap.",
    ),
    context: str | None = Form(
        default=None,
        description="Free-text appended to every CLAP prompt to bias scoring.",
    ),
    inclination: str | None = Form(
        default=None,
        description="JSON object of term->value (the user's current sliders) "
        "blended into the result.",
    ),
) -> JSONResponse:
    model = (model or settings.default_model).lower().strip()
    if model not in AVAILABLE_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown model {model!r}. Choose one of {AVAILABLE_MODELS}.",
        )

    inclination_map = None
    if inclination:
        try:
            parsed = json.loads(inclination)
            inclination_map = {str(k): float(v) for k, v in parsed.items()}
        except (json.JSONDecodeError, AttributeError, TypeError, ValueError) as e:
            raise HTTPException(
                status_code=400,
                detail=f"inclination must be a JSON object of term->number: {e}",
            )

    suffix = os.path.splitext(file.filename or "")[1].lower()
    if suffix and suffix not in _ALLOWED_SUFFIXES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type {suffix!r}. Allowed: {list(_ALLOWED_SUFFIXES)}.",
        )

    body = await file.read()
    if not body:
        raise HTTPException(status_code=400, detail="Empty upload.")
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(body) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large (> {settings.max_upload_mb} MB).",
        )

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            delete=False, suffix=suffix or ".wav"
        ) as tmp:
            tmp.write(body)
            tmp_path = tmp.name

        suggestions = suggest_blanket_amounts(
            tmp_path, model=model, context=context, inclination=inclination_map
        )
    except (ValueError, ImportError) as e:
        # Bad model name, missing BEATs setup, unreadable audio, etc.
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # pragma: no cover - unexpected runtime failure
        raise HTTPException(status_code=500, detail=f"Inference failed: {e}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)

    return JSONResponse(
        {
            "model": model,
            "filename": file.filename,
            "suggestions": suggestions,
        }
    )


def main() -> None:
    import uvicorn

    uvicorn.run(
        "inference.api:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=False,
    )


if __name__ == "__main__":
    main()
