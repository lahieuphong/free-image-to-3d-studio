"""
Post-process a GLB file to enhance texture sharpness and contrast.

Pipeline:
  1. Load GLB with trimesh (preserves PBR materials + UVs)
  2. For each mesh, extract the baseColorTexture (PIL Image)
  3. Apply UnsharpMask + sharpness + contrast enhancement to RGB channels only
  4. Re-export as GLB
  5. Patch doubleSided=true on all materials (same as clean_glb.py)
"""
from __future__ import annotations

import argparse
import json
import shutil
import struct
import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter


def _enhance_image(img: Image.Image) -> Image.Image:
    """Sharpen and slightly boost contrast on RGB channels; alpha is untouched."""
    has_alpha = img.mode == "RGBA"
    if has_alpha:
        r, g, b, a = img.split()
        rgb = Image.merge("RGB", (r, g, b))
    else:
        rgb = img.convert("RGB")

    # UnsharpMask recovers fine detail blurred during texture baking
    rgb = rgb.filter(ImageFilter.UnsharpMask(radius=2, percent=160, threshold=3))
    # Sharpness boost makes edges crisper
    rgb = ImageEnhance.Sharpness(rgb).enhance(1.8)
    # Mild contrast lift improves depth perception
    rgb = ImageEnhance.Contrast(rgb).enhance(1.1)

    if has_alpha:
        r, g, b = rgb.split()
        return Image.merge("RGBA", (r, g, b, a))
    return rgb


def _patch_double_sided(path: Path) -> None:
    """Directly patch the GLTF JSON in the GLB to set doubleSided=true on all materials."""
    try:
        data = path.read_bytes()
        if struct.unpack_from("<I", data, 0)[0] != 0x46546C67:
            return
        json_len = struct.unpack_from("<I", data, 12)[0]
        raw_json = data[20: 20 + json_len].rstrip(b"\x00 ")
        gltf = json.loads(raw_json)
        changed = False
        for mat in gltf.get("materials", []):
            if not mat.get("doubleSided"):
                mat["doubleSided"] = True
                changed = True
        if not changed:
            return
        new_json = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
        pad = (4 - len(new_json) % 4) % 4
        new_json_padded = new_json + b" " * pad
        version = struct.unpack_from("<I", data, 4)[0]
        old_total = struct.unpack_from("<I", data, 8)[0]
        new_total = old_total + len(new_json_padded) - json_len
        file_header = struct.pack("<III", 0x46546C67, version, new_total)
        chunk_header = struct.pack("<II", len(new_json_padded), 0x4E4F534A)
        tail = data[20 + json_len:]
        path.write_bytes(file_header + chunk_header + new_json_padded + tail)
    except Exception:
        pass


def enhance_texture(input_path: Path, output_path: Path) -> int:
    """Return number of textures enhanced (0 = nothing found, fall back to copy)."""
    import trimesh  # noqa: PLC0415

    scene = trimesh.load(str(input_path), force="scene")
    enhanced = 0

    for name, geometry in scene.geometry.items():
        visual = getattr(geometry, "visual", None)
        if visual is None:
            continue
        material = getattr(visual, "material", None)
        if material is None:
            continue

        # PBRMaterial (GLTF/GLB default): baseColorTexture
        # SimpleMaterial (OBJ-style): image
        for attr in ("baseColorTexture", "image", "diffuse"):
            img = getattr(material, attr, None)
            if img is None or not callable(getattr(img, "filter", None)):
                continue
            try:
                setattr(material, attr, _enhance_image(img))
                enhanced += 1
                print(f"[enhance_texture] {name}.{attr}: {img.size} → enhanced")
            except Exception as exc:
                print(f"[enhance_texture] {name}.{attr}: skipped ({exc})", file=sys.stderr)
            break

    if enhanced == 0:
        print("[enhance_texture] No textures found; output = copy of input.")
        shutil.copyfile(input_path, output_path)
        return 0

    scene.export(str(output_path))
    _patch_double_sided(output_path)
    print(f"[enhance_texture] Done — {enhanced} texture(s) enhanced → {output_path.name}")
    return enhanced


def main() -> None:
    parser = argparse.ArgumentParser(description="Enhance GLB texture sharpness")
    parser.add_argument("input_path", type=Path)
    parser.add_argument("output_path", type=Path)
    args = parser.parse_args()
    enhance_texture(args.input_path, args.output_path)


if __name__ == "__main__":
    main()
