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
    drop_lower_ratio: float,
) -> GenerateOptions:
    if texture_resolution not in {512, 1024, 2048}:
        raise HTTPException(status_code=400, detail="texture_resolution phải là 512, 1024 hoặc 2048.")
    if remesh_option not in {"none", "triangle", "quad"}:
        raise HTTPException(status_code=400, detail="remesh_option phải là none, triangle hoặc quad.")
    if target_vertex_count != -1 and not (500 <= target_vertex_count <= 200000):
        raise HTTPException(status_code=400, detail="target_vertex_count phải là -1 hoặc từ 500 đến 200000.")
    if not (0.55 <= foreground_ratio <= 1.4):
        raise HTTPException(status_code=400, detail="foreground_ratio phải nằm trong khoảng 0.55 đến 1.4.")
    if not (0 <= drop_lower_ratio <= 0.8):
        raise HTTPException(status_code=400, detail="drop_lower_ratio phải nằm trong khoảng 0 đến 0.8.")
    return GenerateOptions(
        texture_resolution=texture_resolution,
        remesh_option=remesh_option,
        target_vertex_count=target_vertex_count,
        foreground_ratio=foreground_ratio,
        drop_lower_ratio=drop_lower_ratio,
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
    image: Annotated[UploadFile | None, File(description="PNG/JPG/WEBP image")] = None,
    image_front: Annotated[UploadFile | None, File(description="Front PNG/JPG/WEBP image")] = None,
    image_left: Annotated[UploadFile | None, File(description="Left PNG/JPG/WEBP image")] = None,
    image_right: Annotated[UploadFile | None, File(description="Right PNG/JPG/WEBP image")] = None,
    image_back: Annotated[UploadFile | None, File(description="Back PNG/JPG/WEBP image")] = None,
    texture_resolution: Annotated[int, Form()] = 1024,
    remesh_option: Annotated[str, Form()] = "none",
    target_vertex_count: Annotated[int, Form()] = -1,
    foreground_ratio: Annotated[float, Form()] = 0.85,
    drop_lower_ratio: Annotated[float, Form()] = 0.0,
    view_mode: Annotated[str, Form()] = "single",
):
    primary_image = image_front or image
    if primary_image is None:
        raise HTTPException(status_code=400, detail="Missing image file.")

    if view_mode not in {"single", "four"}:
        raise HTTPException(status_code=400, detail="view_mode must be single or four.")

    view_images = {
        "front": primary_image,
        "left": image_left,
        "right": image_right,
        "back": image_back,
    }
    if view_mode == "four" and any(item is None for item in view_images.values()):
        raise HTTPException(status_code=400, detail="Four-view mode requires front, left, right, and back images.")

    for upload in [item for item in view_images.values() if item is not None]:
        if upload.content_type not in ALLOWED_TYPES:
            raise HTTPException(status_code=400, detail="Only PNG, JPG/JPEG, or WEBP images are supported.")

    image_contents: dict[str, bytes] = {}
    max_bytes = settings.max_upload_mb * 1024 * 1024
    for key, upload in view_images.items():
        if upload is None:
            continue
        content = await upload.read()
        if len(content) > max_bytes:
            raise HTTPException(status_code=400, detail=f"File exceeds {settings.max_upload_mb}MB.")
        image_contents[key] = content

    options = clamp_options(texture_resolution, remesh_option, target_vertex_count, foreground_ratio, drop_lower_ratio)
    content = image_contents["front"]
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=400, detail=f"File vượt quá {settings.max_upload_mb}MB.")

    input_filename = sanitize_filename(primary_image.filename or "input", ALLOWED_TYPES[primary_image.content_type])
    record = store.create(
        provider=provider.name,
        input_filename=input_filename,
        settings={
            "view_mode": view_mode,
            "texture_resolution": texture_resolution,
            "remesh_option": remesh_option,
            "target_vertex_count": target_vertex_count,
            "foreground_ratio": foreground_ratio,
            "drop_lower_ratio": drop_lower_ratio,
        },
    )
    input_path = store.job_dir(record.id) / input_filename
    input_path.write_bytes(content)

    saved_views: list[str] = []
    for key, upload in view_images.items():
        if upload is None or key == "front":
            continue
        filename = sanitize_filename(f"{key}-{upload.filename or key}", ALLOWED_TYPES[upload.content_type])
        (store.job_dir(record.id) / filename).write_bytes(image_contents[key])
        saved_views.append(f"{key}:{filename}")

    if view_mode == "four":
        store.append_logs(
            record.id,
            "Four-view upload received. Stable Fast 3D is single-image, so this job uses the front view for generation and stores the other views as references."
            + (f" Saved references: {', '.join(saved_views)}" if saved_views else ""),
        )

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
