from __future__ import annotations

import os
from dotenv import load_dotenv
from dataclasses import dataclass
from pathlib import Path


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    ai_provider: str
    sf3d_repo_path: Path
    python_bin: str
    storage_dir: Path
    public_base_url: str
    max_upload_mb: int
    allowed_origins: list[str]


def get_settings() -> Settings:
    load_dotenv()
    return Settings(
        ai_provider=os.getenv("AI_PROVIDER", "mock").strip().lower(),
        sf3d_repo_path=Path(os.getenv("SF3D_REPO_PATH", "../third_party/stable-fast-3d")).expanduser().resolve(),
        python_bin=os.getenv("PYTHON_BIN", "python"),
        storage_dir=Path(os.getenv("STORAGE_DIR", "./storage")).expanduser().resolve(),
        public_base_url=os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/"),
        max_upload_mb=int(os.getenv("MAX_UPLOAD_MB", "20")),
        allowed_origins=_split_csv(os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")),
    )
