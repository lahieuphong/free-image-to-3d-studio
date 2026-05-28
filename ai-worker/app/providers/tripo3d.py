from __future__ import annotations

import os
import time
from pathlib import Path

import requests

from app.providers.base import GenerateOptions, Provider
from app.store import JobStore

_MULTIVIEW_KEYS = {"front", "left", "right", "back"}


class TripoProvider(Provider):
    name = "tripo3d"
    BASE_URL = "https://api.tripo3d.ai/v2/openapi"

    def __init__(self, *, api_key: str, model_version: str = "v2.5-20250123"):
        self.api_key = api_key
        self.model_version = model_version

    def _auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}

    def _upload(self, image_path: Path) -> str:
        suffix = image_path.suffix.lower().lstrip(".")
        mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(suffix, "image/jpeg")
        with open(image_path, "rb") as fh:
            resp = requests.post(
                f"{self.BASE_URL}/upload",
                headers=self._auth(),
                files={"file": (image_path.name, fh, mime)},
                timeout=60,
            )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code", 0) != 0:
            raise RuntimeError(f"Tripo3D upload error: {data}")
        return data["data"]["image_token"]

    def _create_single(self, token: str, quality: str) -> str:
        resp = requests.post(
            f"{self.BASE_URL}/task",
            headers={**self._auth(), "Content-Type": "application/json"},
            json={
                "type": "image_to_model",
                "file": {"type": "png", "token": token},
                "model_version": self.model_version,
                "quality": quality,
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code", 0) != 0:
            raise RuntimeError(f"Tripo3D task creation error: {data}")
        return data["data"]["task_id"]

    def _create_multiview(self, tokens: dict[str, str]) -> str:
        resp = requests.post(
            f"{self.BASE_URL}/task",
            headers={**self._auth(), "Content-Type": "application/json"},
            json={
                "type": "multiview_to_model",
                "files": {k: {"type": "png", "token": v} for k, v in tokens.items()},
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("code", 0) != 0:
            raise RuntimeError(f"Tripo3D multiview task error: {data}")
        return data["data"]["task_id"]

    def _poll(self, task_id: str, *, job_id: str, store: JobStore, timeout_sec: int = 600) -> str:
        deadline = time.monotonic() + timeout_sec
        while True:
            if time.monotonic() > deadline:
                raise TimeoutError(f"Tripo3D task timed out after {timeout_sec}s.")
            resp = requests.get(f"{self.BASE_URL}/task/{task_id}", headers=self._auth(), timeout=30)
            resp.raise_for_status()
            data = resp.json()
            if data.get("code", 0) != 0:
                raise RuntimeError(f"Tripo3D poll error: {data}")
            task = data["data"]
            status = task.get("status", "")
            if status == "success":
                return task["result"]["model"]["url"]
            if status in {"failed", "cancelled"}:
                raise RuntimeError(f"Tripo3D task {status}: {task.get('message', 'no details')}")
            raw_progress = int(task.get("progress", 0))
            mapped_progress = 12 + int(raw_progress * 0.80)
            store.update(job_id, progress=mapped_progress, logs_tail=f"Tripo3D: {status} {raw_progress}%")
            time.sleep(3)

    def generate(self, *, job_id: str, store: JobStore, options: GenerateOptions) -> None:
        input_path = store.input_path(job_id)
        view_paths = dict(options.view_paths)
        quality = options.tripo_quality if options.tripo_quality in {"standard", "detailed"} else "standard"

        has_multiview = _MULTIVIEW_KEYS.issubset({"front", *view_paths.keys()})

        store.update(job_id, status="running", progress=5, logs_tail="Uploading image to Tripo3D...")
        front_token = self._upload(input_path)

        if has_multiview:
            store.append_logs(job_id, "Multi-view mode: uploading left/right/back views...")
            tokens: dict[str, str] = {"front": front_token}
            for step, key in enumerate(("left", "right", "back"), start=1):
                if key in view_paths:
                    tokens[key] = self._upload(Path(view_paths[key]))
                    store.update(job_id, progress=5 + step * 2)
            task_id = self._create_multiview(tokens)
            store.append_logs(job_id, f"Multi-view task {task_id} created.")
        else:
            task_id = self._create_single(front_token, quality)
            store.append_logs(job_id, f"Single-image task {task_id} (quality={quality}) created.")

        store.update(job_id, progress=12, logs_tail="Tripo3D task running, polling...")
        model_url = self._poll(task_id, job_id=job_id, store=store)

        store.update(job_id, progress=95, logs_tail="Downloading GLB from Tripo3D...")
        resp = requests.get(model_url, timeout=120)
        resp.raise_for_status()
        store.result_path(job_id).write_bytes(resp.content)
        store.update(job_id, status="succeeded", progress=100, result_filename="model.glb")
