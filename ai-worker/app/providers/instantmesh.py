from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from app.providers.base import GenerateOptions, Provider
from app.store import JobStore


class InstantMeshProvider(Provider):
    """InstantMesh: single-image → multi-view synthesis → 3D reconstruction.

    Internally generates 6 novel views via Zero123++ then runs a sparse-view
    reconstruction — giving much better results than SF3D for complex objects.

    Setup:
        git clone https://github.com/TencentARC/InstantMesh ../third_party/InstantMesh
        cd ../third_party/InstantMesh && pip install -r requirements.txt
    """

    name = "instantmesh"

    def __init__(self, *, repo_path: Path, python_bin: str):
        self.repo_path = repo_path
        self.python_bin = python_bin

    def _validate(self) -> None:
        run_py = self.repo_path / "run.py"
        if not self.repo_path.exists() or not run_py.exists():
            raise FileNotFoundError(
                "InstantMesh repo not found. "
                "Clone https://github.com/TencentARC/InstantMesh to INSTANTMESH_REPO_PATH "
                "and install requirements."
            )

    def _find_output(self, output_dir: Path, stem: str) -> Path | None:
        for rel in (
            f"{stem}/mesh.glb",
            f"{stem}.glb",
            f"{stem}/mesh.obj",
            f"{stem}.obj",
        ):
            candidate = output_dir / rel
            if candidate.exists():
                return candidate
        for ext in (".glb", ".obj"):
            hits = sorted(output_dir.rglob(f"*{ext}"))
            if hits:
                return hits[0]
        return None

    def _to_glb(self, *, mesh_path: Path, glb_path: Path) -> None:
        script = Path(__file__).with_name("convert_to_glb.py")
        proc = subprocess.run(
            [self.python_bin, str(script), str(mesh_path), str(glb_path)],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"OBJ→GLB conversion failed:\n{proc.stderr.strip()}")

    def generate(self, *, job_id: str, store: JobStore, options: GenerateOptions) -> None:
        self._validate()
        input_path = store.input_path(job_id)
        output_dir = store.job_dir(job_id) / "instantmesh-output"
        output_dir.mkdir(exist_ok=True)

        config = options.instantmesh_config
        if config not in {"instant-mesh-large", "instant-mesh-base"}:
            config = "instant-mesh-large"

        cmd = [
            self.python_bin,
            "run.py",
            "--config", f"configs/{config}.yaml",
            str(input_path),
            "--output_path", str(output_dir),
            "--export_texmap",
        ]
        device = os.getenv("INSTANTMESH_DEVICE", "").strip()
        if device:
            cmd.extend(["--device", device])

        store.update(job_id, status="running", progress=8, logs_tail=f"Starting InstantMesh ({config})...")
        process = subprocess.Popen(
            cmd,
            cwd=self.repo_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert process.stdout is not None
        progress = 12
        for line in process.stdout:
            line = line.rstrip()
            if line:
                store.append_logs(job_id, line)
            progress = min(88, progress + 2)
            store.update(job_id, progress=progress)

        return_code = process.wait()
        if return_code != 0:
            logs = store.get(job_id).logs_tail or ""
            raise RuntimeError(f"InstantMesh failed (exit {return_code}).\n{logs[-800:]}")

        stem = input_path.stem
        output_mesh = self._find_output(output_dir, stem)
        if output_mesh is None:
            raise FileNotFoundError("InstantMesh finished but no mesh file found in output directory.")

        result_path = store.result_path(job_id)
        if output_mesh.suffix.lower() == ".glb":
            shutil.copyfile(output_mesh, result_path)
        else:
            store.update(job_id, progress=90, logs_tail="Converting mesh → GLB...")
            self._to_glb(mesh_path=output_mesh, glb_path=result_path)

        store.update(job_id, status="succeeded", progress=100, result_filename="model.glb")
