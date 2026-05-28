"""OBJ/other mesh → GLB conversion helper.
Called via subprocess from the InstantMesh (or SF3D) Python bin so trimesh
lives in the model venv, not the AI-worker venv.
"""
from __future__ import annotations

import sys
from pathlib import Path

import trimesh


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: convert_to_glb.py <input> <output.glb>", file=sys.stderr)
        sys.exit(1)

    src = Path(sys.argv[1])
    dst = Path(sys.argv[2])
    dst.parent.mkdir(parents=True, exist_ok=True)

    scene = trimesh.load(str(src), force="scene")
    scene.export(str(dst))
    print(f"Converted {src} → {dst}")


if __name__ == "__main__":
    main()
