from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from app.providers.base import GenerateOptions, Provider
from app.store import JobStore


class StableFast3DProvider(Provider):
    name = "sf3d"

    def __init__(self, *, repo_path: Path, python_bin: str):
        self.repo_path = repo_path
        self.python_bin = python_bin

    def _validate(self) -> None:
        run_py = self.repo_path / "run.py"
        if not self.repo_path.exists() or not run_py.exists():
            raise FileNotFoundError(
                "Không tìm thấy Stable Fast 3D repo. Hãy clone repo vào SF3D_REPO_PATH hoặc chạy scripts/setup-sf3d.sh."
            )

    def _clean_model(self, *, job_id: str, store: JobStore, input_path: Path, options: GenerateOptions) -> Path:
        if os.getenv("SF3D_CLEAN_ARTIFACTS", "1").strip().lower() in {"0", "false", "no", "off"}:
            return input_path

        output_path = input_path.with_name("model.cleaned.glb")
        drop_lower_ratio = (
            str(options.drop_lower_ratio)
            if options.drop_lower_ratio > 0
            else os.getenv("SF3D_CLEAN_DROP_LOWER_RATIO", "0").strip()
        )
        process = subprocess.run(
            [
                self.python_bin,
                str(Path(__file__).with_name("clean_glb.py")),
                str(input_path),
                str(output_path),
                "--min-area-ratio",
                os.getenv("SF3D_CLEAN_MIN_AREA_RATIO", "0.025").strip(),
                "--keep-area-ratio",
                os.getenv("SF3D_CLEAN_KEEP_AREA_RATIO", "0.985").strip(),
                "--min-faces",
                os.getenv("SF3D_CLEAN_MIN_FACES", "1").strip(),
                "--drop-lower-ratio",
                drop_lower_ratio,
            ],
            cwd=self.repo_path,
            capture_output=True,
            text=True,
            check=False,
        )

        logs = "\n".join(part for part in [process.stdout.strip(), process.stderr.strip()] if part)
        if logs:
            store.append_logs(job_id, logs)

        if process.returncode != 0 or not output_path.exists():
            store.append_logs(job_id, "GLB cleanup failed; using original SF3D output.")
            return input_path

        return output_path

    def generate(self, *, job_id: str, store: JobStore, options: GenerateOptions) -> None:
        self._validate()
        job_dir = store.job_dir(job_id)
        input_path = store.input_path(job_id)
        sf3d_output_dir = job_dir / "sf3d-output"
        sf3d_output_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            self.python_bin,
            "run.py",
            str(input_path),
            "--output-dir",
            str(sf3d_output_dir),
            "--texture-resolution",
            str(options.texture_resolution),
            "--remesh_option",
            options.remesh_option,
            "--target_vertex_count",
            str(options.target_vertex_count),
            "--foreground-ratio",
            str(options.foreground_ratio),
        ]
        device = os.getenv("SF3D_DEVICE", "").strip()
        if device:
            cmd.extend(["--device", device])

        store.update(job_id, status="running", progress=8, logs_tail="Starting Stable Fast 3D...")
        env = os.environ.copy()
        process = subprocess.Popen(
            cmd,
            cwd=self.repo_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env=env,
        )

        assert process.stdout is not None
        progress = 12
        for line in process.stdout:
            line = line.rstrip()
            if line:
                store.append_logs(job_id, line)
            progress = min(92, progress + 3)
            store.update(job_id, progress=progress)

        return_code = process.wait()
        if return_code != 0:
            logs = store.get(job_id).logs_tail
            raise RuntimeError(f"Stable Fast 3D failed với exit code {return_code}. Logs:\n{logs or ''}")

        candidates = sorted(sf3d_output_dir.rglob("*.glb"))
        if not candidates:
            raise FileNotFoundError("Stable Fast 3D đã chạy xong nhưng không tìm thấy file .glb trong output.")

        final_model_path = self._clean_model(job_id=job_id, store=store, input_path=candidates[0], options=options)
        shutil.copyfile(final_model_path, store.result_path(job_id))
        store.update(
            job_id,
            status="succeeded",
            progress=100,
            result_filename="model.glb",
        )
