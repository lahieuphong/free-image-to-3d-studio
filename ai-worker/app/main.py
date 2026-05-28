from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.config import get_settings
from app.providers.base import GenerateOptions, Provider
from app.providers.mock import MockProvider
from app.providers.sf3d import StableFast3DProvider
from app.store import JobStore

settings = get_settings()
store = JobStore(settings.storage_dir)
assets_dir = Path(__file__).resolve().parents[1] / "assets"


def build_provider() -> Provider:
    if settings.ai_provider == "mock":
        return MockProvider(assets_dir=assets_dir)
    if settings.ai_provider == "sf3d":
        return StableFast3DProvider(repo_path=settings.sf3d_repo_path, python_bin=settings.python_bin)
    raise RuntimeError(f"AI_PROVIDER không hợp lệ: {settings.ai_provider}. Dùng mock hoặc sf3d.")


provider = build_provider()
app = FastAPI(title="Free Image to 3D AI Worker", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9._-]+")
ALLOWED_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


def sanitize_filename(filename: str, fallback_ext: str) -> str:
    name = SAFE_NAME_RE.sub("_", Path(filename).name).strip("._")
    if not name:
        name = f"input{fallback_ext}"
    if Path(name).suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
        name = f"{name}{fallback_ext}"
    return name


def clamp_options(
    texture_resolution: int,
    remesh_option: str,
    target_vertex_count: int,
    foreground_ratio: float,
) -> GenerateOptions:
    if texture_resolution not in {512, 1024, 2048}:
        raise HTTPException(status_code=400, detail="texture_resolution phải là 512, 1024 hoặc 2048.")
    if remesh_option not in {"none", "triangle", "quad"}:
        raise HTTPException(status_code=400, detail="remesh_option phải là none, triangle hoặc quad.")
    if target_vertex_count != -1 and not (500 <= target_vertex_count <= 200000):
        raise HTTPException(status_code=400, detail="target_vertex_count phải là -1 hoặc từ 500 đến 200000.")
    if not (0.55 <= foreground_ratio <= 1.4):
        raise HTTPException(status_code=400, detail="foreground_ratio phải nằm trong khoảng 0.55 đến 1.4.")
    return GenerateOptions(
        texture_resolution=texture_resolution,
        remesh_option=remesh_option,
        target_vertex_count=target_vertex_count,
        foreground_ratio=foreground_ratio,
    )


def run_generation(job_id: str, options: GenerateOptions) -> None:
    try:
        provider.generate(job_id=job_id, store=store, options=options)
    except Exception as exc:  # noqa: BLE001 - surface error to job record
        store.update(job_id, status="failed", progress=100, error=str(exc))


@app.get("/api/health")
def health() -> dict[str, str]:
    return {
        "ok": "true",
        "provider": provider.name,
        "storage_dir": str(settings.storage_dir),
    }


@app.post("/api/jobs")
async def create_job(
    image: Annotated[UploadFile, File(description="PNG/JPG/WEBP image")],
    texture_resolution: Annotated[int, Form()] = 1024,
    remesh_option: Annotated[str, Form()] = "none",
    target_vertex_count: Annotated[int, Form()] = -1,
    foreground_ratio: Annotated[float, Form()] = 0.85,
):
    if image.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Chỉ hỗ trợ PNG, JPG/JPEG hoặc WEBP.")

    options = clamp_options(texture_resolution, remesh_option, target_vertex_count, foreground_ratio)
    content = await image.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=400, detail=f"File vượt quá {settings.max_upload_mb}MB.")

    input_filename = sanitize_filename(image.filename or "input", ALLOWED_TYPES[image.content_type])
    record = store.create(
        provider=provider.name,
        input_filename=input_filename,
        settings={
            "texture_resolution": texture_resolution,
            "remesh_option": remesh_option,
            "target_vertex_count": target_vertex_count,
            "foreground_ratio": foreground_ratio,
        },
    )
    input_path = store.job_dir(record.id) / input_filename
    input_path.write_bytes(content)

    asyncio.create_task(asyncio.to_thread(run_generation, record.id, options))
    return record.public(settings.public_base_url)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    try:
        record = store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job không tồn tại.") from exc
    return record.public(settings.public_base_url)


@app.get("/api/jobs/{job_id}/model.glb")
def get_model(job_id: str):
    try:
        record = store.get(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Job không tồn tại.") from exc

    if record.status != "succeeded" or not record.result_filename:
        raise HTTPException(status_code=404, detail="Model chưa sẵn sàng.")

    result_path = store.result_path(job_id)
    if not result_path.exists():
        raise HTTPException(status_code=404, detail="File GLB không tồn tại.")

    return FileResponse(
        result_path,
        media_type="model/gltf-binary",
        filename=f"{job_id}.glb",
    )
