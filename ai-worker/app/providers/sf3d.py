from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from app.providers.base import GenerateOptions, Provider
from app.store import JobStore

PROXY_ENV_NAMES = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "GIT_HTTP_PROXY",
    "GIT_HTTPS_PROXY",
)


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

    def _build_env(self) -> dict[str, str]:
        env = os.environ.copy()
        # Remove vars that the ai-worker venv activation may set and that would
        # cause the SF3D subprocess (a different venv) to resolve the wrong
        # site-packages or Python home directory.
        for key in ("PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "VIRTUAL_ENV_PROMPT"):
            env.pop(key, None)
        if os.getenv("SF3D_CLEAR_PROXY", "1").strip().lower() not in {"0", "false", "no", "off"}:
            for key in PROXY_ENV_NAMES:
                value = env.get(key, "")
                if "127.0.0.1:9" in value or "localhost:9" in value:
                    env.pop(key, None)
        if os.getenv("SF3D_HF_OFFLINE", "1").strip().lower() not in {"0", "false", "no", "off"}:
            env["HF_HUB_OFFLINE"] = "1"
            env["TRANSFORMERS_OFFLINE"] = "1"
        return env

    def _cached_pretrained_model_path(self) -> Path | None:
        explicit_path = os.getenv("SF3D_PRETRAINED_MODEL_PATH", "").strip()
        if explicit_path:
            path = Path(explicit_path).expanduser().resolve()
            if (path / "config.yaml").exists() and (path / "model.safetensors").exists():
                return path

        cache_root = os.getenv("HUGGINGFACE_HUB_CACHE", "").strip()
        if cache_root:
            hub_dir = Path(cache_root).expanduser().resolve()
        else:
            hf_home = os.getenv("HF_HOME", "").strip()
            hub_dir = (Path(hf_home).expanduser().resolve() / "hub") if hf_home else Path.home() / ".cache" / "huggingface" / "hub"

        model_dir = hub_dir / "models--stabilityai--stable-fast-3d"
        snapshots_dir = model_dir / "snapshots"
        ref_path = model_dir / "refs" / "main"
        candidates: list[Path] = []
        if ref_path.exists():
            candidates.append(snapshots_dir / ref_path.read_text(encoding="utf-8").strip())
        if snapshots_dir.exists():
            candidates.extend(path for path in snapshots_dir.iterdir() if path.is_dir())

        for path in candidates:
            if (path / "config.yaml").exists() and (path / "model.safetensors").exists():
                return path
        return None

    def _preprocess_image(self, *, job_id: str, store: JobStore, input_path: Path) -> tuple[Path, bool]:
        """Returns (path_to_use, was_preprocessed).

        Uses birefnet-general (much better than SF3D's default u2net) to remove the
        background, then centers and pads the object so SF3D gets a clean silhouette.
        When preprocessing succeeds we later pass --no_remove_bg to SF3D so it doesn't
        run rembg a second time and degrade the alpha we worked hard to produce.
        """
        if os.getenv("SF3D_SKIP_PREPROCESS", "0").strip().lower() in {"1", "true", "yes", "on"}:
            return input_path, False

        output_path = input_path.with_name("input_preprocessed.png")
        rembg_model = os.getenv("SF3D_REMBG_MODEL", "birefnet-general").strip()
        target_size = os.getenv("SF3D_PREPROCESS_SIZE", "1024").strip()

        process = subprocess.run(
            [
                self.python_bin,
                str(Path(__file__).with_name("preprocess_image.py")),
                str(input_path),
                str(output_path),
                "--rembg-model",
                rembg_model,
                "--target-size",
                target_size,
            ],
            cwd=self.repo_path,
            capture_output=True,
            text=True,
            check=False,
            env=self._build_env(),
        )

        logs = "\n".join(part for part in [process.stdout.strip(), process.stderr.strip()] if part)
        if logs:
            store.append_logs(job_id, logs)

        if process.returncode != 0 or not output_path.exists():
            store.append_logs(job_id, "Image preprocessing failed; using original input.")
            return input_path, False

        return output_path, True

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

        store.update(job_id, status="running", progress=5, logs_tail="Preprocessing image...")
        preprocessed_path, was_preprocessed = self._preprocess_image(job_id=job_id, store=store, input_path=input_path)

        cmd = [
            self.python_bin,
            "run.py",
            str(preprocessed_path),
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
        if was_preprocessed:
            cmd.append("--no-remove-bg")
        device = os.getenv("SF3D_DEVICE", "").strip()
        if device:
            cmd.extend(["--device", device])
        pretrained_model_path = self._cached_pretrained_model_path()
        if pretrained_model_path is not None:
            cmd.extend(["--pretrained-model", str(pretrained_model_path)])

        store.update(job_id, status="running", progress=8, logs_tail="Starting Stable Fast 3D...")
        env = self._build_env()
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
