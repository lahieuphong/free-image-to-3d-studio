"""
Image preprocessor for Stable Fast 3D:
  1. Remove background (rembg birefnet-general, much better than u2net for product photos)
  2. Center the object and pad into a square transparent canvas
  3. Resize to target size

Passing a pre-processed PNG with clean alpha to SF3D + --no_remove_bg avoids double
background-removal and gives SF3D a much cleaner silhouette to work from.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def _has_transparency(img: Image.Image) -> bool:
    if img.mode == "RGBA":
        arr = np.array(img)
        return bool((arr[:, :, 3] < 255).any())
    return False


def _remove_bg(img: Image.Image, model_name: str) -> Image.Image:
    try:
        from rembg import new_session, remove  # noqa: PLC0415
        session = new_session(model_name)
        return remove(img.convert("RGBA"), session=session)
    except Exception as exc:  # noqa: BLE001
        print(f"[preprocess] rembg failed ({exc}); skipping background removal.", file=sys.stderr)
        return img.convert("RGBA")


def _center_pad(img: Image.Image, pad_ratio: float = 0.15) -> Image.Image:
    arr = np.array(img.convert("RGBA"))
    alpha = arr[:, :, 3]

    rows = np.any(alpha > 10, axis=1)
    cols = np.any(alpha > 10, axis=0)

    if not rows.any() or not cols.any():
        return img

    rmin = int(np.where(rows)[0][0])
    rmax = int(np.where(rows)[0][-1])
    cmin = int(np.where(cols)[0][0])
    cmax = int(np.where(cols)[0][-1])

    obj_h = rmax - rmin + 1
    obj_w = cmax - cmin + 1
    obj_size = max(obj_h, obj_w)
    pad = max(4, int(obj_size * pad_ratio))

    canvas_size = obj_size + pad * 2
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))

    x = (canvas_size - obj_w) // 2
    y = (canvas_size - obj_h) // 2
    cropped = img.crop((cmin, rmin, cmax + 1, rmax + 1))
    canvas.paste(cropped, (x, y), cropped)
    return canvas


def preprocess(
    input_path: Path,
    output_path: Path,
    *,
    rembg_model: str = "birefnet-general",
    target_size: int = 1024,
    skip_rembg: bool = False,
) -> None:
    with Image.open(input_path) as img:
        img = img.copy()

    original_size = img.size

    if skip_rembg or _has_transparency(img):
        rgba = img.convert("RGBA")
        bg_note = "already transparent"
    else:
        rgba = _remove_bg(img, rembg_model)
        bg_note = f"rembg:{rembg_model}"

    padded = _center_pad(rgba)

    if padded.width != target_size or padded.height != target_size:
        padded = padded.resize((target_size, target_size), Image.LANCZOS)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    padded.save(output_path, "PNG")
    print(f"[preprocess] {original_size} → {padded.size} ({bg_note})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Preprocess image for SF3D")
    parser.add_argument("input_path", type=Path)
    parser.add_argument("output_path", type=Path)
    parser.add_argument("--rembg-model", default="birefnet-general")
    parser.add_argument("--target-size", type=int, default=1024)
    parser.add_argument("--skip-rembg", action="store_true")
    args = parser.parse_args()

    preprocess(
        args.input_path,
        args.output_path,
        rembg_model=args.rembg_model,
        target_size=args.target_size,
        skip_rembg=args.skip_rembg,
    )


if __name__ == "__main__":
    main()
