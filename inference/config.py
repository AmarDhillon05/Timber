"""Environment-backed configuration for the inference service."""

from __future__ import annotations

import os
from dataclasses import dataclass, field

try:
    # Optional: load a local .env if python-dotenv is installed.
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover - dotenv is optional
    pass


def _resolve_device(value: str) -> str:
    if value and value != "auto":
        return value
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


@dataclass
class Settings:
    # Model identifiers / checkpoints
    ast_model_id: str = field(
        default_factory=lambda: os.getenv(
            "AST_MODEL_ID", "MIT/ast-finetuned-audioset-10-10-0.4593"
        )
    )
    clap_model_id: str = field(
        default_factory=lambda: os.getenv("CLAP_MODEL_ID", "laion/clap-htsat-unfused")
    )
    beats_checkpoint: str = field(
        default_factory=lambda: os.getenv("BEATS_CHECKPOINT", "")
    )
    # Directory holding the BEATs model code (BEATs.py, backbone.py, ...).
    beats_code_dir: str = field(
        default_factory=lambda: os.getenv(
            "BEATS_CODE_DIR",
            os.path.join(os.path.dirname(__file__), "beats"),
        )
    )
    # AudioSet index/mid/display_name CSV, used to turn BEATs label ids into names.
    beats_labels_csv: str = field(
        default_factory=lambda: os.getenv(
            "BEATS_LABELS_CSV",
            os.path.join(os.path.dirname(__file__), "beats", "class_labels_indices.csv"),
        )
    )

    # Runtime
    device: str = field(
        default_factory=lambda: _resolve_device(os.getenv("DEVICE", "auto"))
    )
    default_model: str = field(
        default_factory=lambda: os.getenv("DEFAULT_MODEL", "clap")
    )

    # Optional HF cache / token (handy for gated or offline setups)
    hf_home: str = field(default_factory=lambda: os.getenv("HF_HOME", ""))

    # API
    api_host: str = field(default_factory=lambda: os.getenv("API_HOST", "0.0.0.0"))
    api_port: int = field(default_factory=lambda: int(os.getenv("API_PORT", "8000")))
    max_upload_mb: int = field(
        default_factory=lambda: int(os.getenv("MAX_UPLOAD_MB", "50"))
    )

    def __post_init__(self) -> None:
        if self.hf_home:
            os.environ.setdefault("HF_HOME", self.hf_home)


settings = Settings()
