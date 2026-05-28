from __future__ import annotations

import asyncio
import dataclasses
import re
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.config import get_settings
from app.providers.base import GenerateOptions, Provider
from app.providers.instantmesh import InstantMeshProvider
from app.providers.mock import MockProvider
from app.providers.sf3d import StableFast3DProvider
from app.providers.tripo3d import TripoProvider
from app.store import JobStore

settings = get_settings()
store = JobStore(settings.storage_dir)
assets_dir = Path(__file__).resolve().parents[1] / "assets"

SAFE_NAME_RE = re.compile(r"[^a-zA-Z0-9._-]+")
ALLOWED_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


def _build_providers() -> tuple[dict[str, Provider], str]:
    """Build registry of available providers. Returns (registry, default_name)."""
    reg: dict[str, Provider] = {}

    reg["mock"] = MockProvider(assets_dir=assets_dir)

    reg["sf3d"] = StableFast3DProvider(
        repo_path=settings.sf3d_repo_path,
        python_bin=settings.python_bin,
    )

    if settings.tripo3d_api_key:
        reg["tripo3d"] = TripoProvider(
            api_key=settings.tripo3d_api_key,
            model_version=settings.tripo3d_model_version,
        )

    if settings.instantmesh_repo_path.exists():
        reg["instantmesh"] = InstantMeshProvider(
            repo_path=settings.instantmesh_repo_path,
            python_bin=settings.instantmesh_python_bin,
        )

    default = settings.ai_provider if settings.ai_provider in reg else "mock"
    return reg, default


providers, default_provider_name = _build_providers()

app = FastAPI(title="Free Image to 3D AI Worker", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    tripo_quality: str,
    instantmesh_config: str,
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
    if tripo_quality not in {"standard", "detailed"}:
        tripo_quality = "standard"
    if instantmesh_config not in {"instant-mesh-large", "instant-mesh-base"}:
        instantmesh_config = "instant-mesh-large"
    return GenerateOptions(
        texture_resolution=texture_resolution,
        remesh_option=remesh_option,
        target_vertex_count=target_vertex_count,
        foreground_ratio=foreground_ratio,
        drop_lower_ratio=drop_lower_ratio,
        tripo_quality=tripo_quality,
        instantmesh_config=instantmesh_config,
    )


def run_generation(job_id: str, options: GenerateOptions, provider: Provider) -> None:
    try:
        provider.generate(job_id=job_id, store=store, options=options)
    except Exception as exc:  # noqa: BLE001
        store.update(job_id, status="failed", progress=100, error=str(exc))


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": "true",
        "default_provider": default_provider_name,
        "available_providers": list(providers.keys()),
        "storage_dir": str(settings.storage_dir),
    }


@app.post("/api/jobs")
async def create_job(
    image: Annotated[UploadFile | None, File()] = None,
    image_front: Annotated[UploadFile | None, File()] = None,
    image_left: Annotated[UploadFile | None, File()] = None,
    image_right: Annotated[UploadFile | None, File()] = None,
    image_back: Annotated[UploadFile | None, File()] = None,
    image_top: Annotated[UploadFile | None, File()] = None,
    image_bottom: Annotated[UploadFile | None, File()] = None,
    texture_resolution: Annotated[int, Form()] = 1024,
    remesh_option: Annotated[str, Form()] = "none",
    target_vertex_count: Annotated[int, Form()] = -1,
    foreground_ratio: Annotated[float, Form()] = 0.85,
    drop_lower_ratio: Annotated[float, Form()] = 0.0,
    tripo_quality: Annotated[str, Form()] = "standard",
    instantmesh_config: Annotated[str, Form()] = "instant-mesh-large",
    view_mode: Annotated[str, Form()] = "single",
    provider_choice: Annotated[str, Form()] = "",
):
    primary_image = image_front or image
    if primary_image is None:
        raise HTTPException(status_code=400, detail="Missing image file.")

    if view_mode not in {"single", "four", "six"}:
        raise HTTPException(status_code=400, detail="view_mode must be single, four, or six.")

    view_images = {
        "front": primary_image,
        "left": image_left,
        "right": image_right,
        "back": image_back,
        "top": image_top,
        "bottom": image_bottom,
    }
    required_view_keys = ["front"] if view_mode == "single" else ["front", "left", "right", "back"]
    if view_mode == "six":
        required_view_keys.extend(["top", "bottom"])
    if any(view_images[key] is None for key in required_view_keys):
        raise HTTPException(
            status_code=400,
            detail=f"{view_mode}-view mode requires {', '.join(required_view_keys)} images.",
        )

    for upload in [item for item in view_images.values() if item is not None]:
        if upload.content_type not in ALLOWED_TYPES:
            raise HTTPException(status_code=400, detail="Only PNG, JPG/JPEG, or WEBP images are supported.")

    max_bytes = settings.max_upload_mb * 1024 * 1024
    image_contents: dict[str, bytes] = {}
    for key, upload in view_images.items():
        if upload is None:
            continue
        content = await upload.read()
        if len(content) > max_bytes:
            raise HTTPException(status_code=400, detail=f"File exceeds {settings.max_upload_mb}MB.")
        image_contents[key] = content

    active_provider = providers.get(provider_choice) if provider_choice else None
    if active_provider is None:
        active_provider = providers[default_provider_name]

    options = clamp_options(
        texture_resolution, remesh_option, target_vertex_count, foreground_ratio,
        drop_lower_ratio, tripo_quality, instantmesh_config,
    )

    input_filename = sanitize_filename(
        primary_image.filename or "input",
        ALLOWED_TYPES[primary_image.content_type],
    )
    record = store.create(
        provider=active_provider.name,
        input_filename=input_filename,
        settings={
            "view_mode": view_mode,
            "provider": active_provider.name,
            "texture_resolution": texture_resolution,
            "remesh_option": remesh_option,
            "target_vertex_count": target_vertex_count,
            "foreground_ratio": foreground_ratio,
            "drop_lower_ratio": drop_lower_ratio,
            "tripo_quality": tripo_quality,
            "instantmesh_config": instantmesh_config,
        },
    )
    input_path = store.job_dir(record.id) / input_filename
    input_path.write_bytes(image_contents["front"])

    # Save extra views and collect their paths for multi-view providers (e.g. Tripo3D)
    view_paths_list: list[tuple[str, str]] = []
    for key, upload in view_images.items():
        if upload is None or key == "front":
            continue
        filename = sanitize_filename(f"{key}-{upload.filename or key}", ALLOWED_TYPES[upload.content_type])
        file_path = store.job_dir(record.id) / filename
        file_path.write_bytes(image_contents[key])
        view_paths_list.append((key, str(file_path)))

    if view_mode in {"four", "six"}:
        note = (
            f"{view_mode}-view upload received. "
            f"Provider '{active_provider.name}' will use "
            + ("all views." if active_provider.name == "tripo3d" else "the front view (other views saved as reference).")
        )
        store.append_logs(record.id, note)

    options = dataclasses.replace(options, view_paths=tuple(view_paths_list))

    asyncio.create_task(asyncio.to_thread(run_generation, record.id, options, active_provider))
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

    return FileResponse(result_path, media_type="model/gltf-binary", filename=f"{job_id}.glb")
