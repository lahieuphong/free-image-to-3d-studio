from __future__ import annotations

import shutil
import time
from pathlib import Path

from app.providers.base import GenerateOptions, Provider
from app.store import JobStore


class MockProvider(Provider):
    name = "mock"

    def __init__(self, assets_dir: Path):
        self.sample_glb = assets_dir / "sample.glb"

    def generate(self, *, job_id: str, store: JobStore, options: GenerateOptions) -> None:
        if not self.sample_glb.exists():
            raise FileNotFoundError(f"Không tìm thấy sample GLB: {self.sample_glb}")

        store.update(job_id, status="running", progress=12)
        for progress in (24, 38, 52, 68, 84):
            time.sleep(0.35)
            store.update(job_id, progress=progress)

        output_path = store.result_path(job_id)
        shutil.copyfile(self.sample_glb, output_path)
        store.update(
            job_id,
            status="succeeded",
            progress=100,
            result_filename="model.glb",
            logs_tail="Mock mode: đã trả sample.glb để test UI. Set AI_PROVIDER=sf3d để chạy AI thật.",
        )
