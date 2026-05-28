from __future__ import annotations

import json
import threading
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

JobStatus = Literal["queued", "running", "succeeded", "failed"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class JobRecord:
    id: str
    status: JobStatus
    progress: int
    provider: str
    input_filename: str
    settings: dict[str, Any]
    created_at: str = field(default_factory=now_iso)
    updated_at: str = field(default_factory=now_iso)
    result_filename: str | None = None
    error: str | None = None
    logs_tail: str | None = None

    def public(self, public_base_url: str) -> dict[str, Any]:
        result_url = None
        if self.status == "succeeded" and self.result_filename:
            result_url = f"{public_base_url}/api/jobs/{self.id}/model.glb"

        return {
            "id": self.id,
            "status": self.status,
            "progress": self.progress,
            "provider": self.provider,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "result_url": result_url,
            "error": self.error,
            "logs_tail": self.logs_tail,
        }


class JobStore:
    def __init__(self, storage_dir: Path):
        self.storage_dir = storage_dir
        self.jobs_dir = storage_dir / "jobs"
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def job_dir(self, job_id: str) -> Path:
        return self.jobs_dir / job_id

    def input_path(self, job_id: str) -> Path:
        record = self.get(job_id)
        return self.job_dir(job_id) / record.input_filename

    def result_path(self, job_id: str) -> Path:
        return self.job_dir(job_id) / "model.glb"

    def _record_path(self, job_id: str) -> Path:
        return self.job_dir(job_id) / "job.json"

    def create(self, *, provider: str, input_filename: str, settings: dict[str, Any]) -> JobRecord:
        job_id = uuid.uuid4().hex
        record = JobRecord(
            id=job_id,
            status="queued",
            progress=3,
            provider=provider,
            input_filename=input_filename,
            settings=settings,
        )
        with self._lock:
            self.job_dir(job_id).mkdir(parents=True, exist_ok=False)
            self._save(record)
        return record

    def get(self, job_id: str) -> JobRecord:
        path = self._record_path(job_id)
        if not path.exists():
            raise KeyError(job_id)
        with self._lock:
            data = json.loads(path.read_text(encoding="utf-8"))
        return JobRecord(**data)

    def update(self, job_id: str, **changes: Any) -> JobRecord:
        with self._lock:
            record = self.get(job_id)
            for key, value in changes.items():
                setattr(record, key, value)
            record.updated_at = now_iso()
            self._save(record)
            return record

    def append_logs(self, job_id: str, text: str, *, max_chars: int = 4000) -> None:
        with self._lock:
            record = self.get(job_id)
            combined = ((record.logs_tail or "") + "\n" + text).strip()
            record.logs_tail = combined[-max_chars:]
            record.updated_at = now_iso()
            self._save(record)

    def _save(self, record: JobRecord) -> None:
        self._record_path(record.id).write_text(json.dumps(asdict(record), ensure_ascii=False, indent=2), encoding="utf-8")
