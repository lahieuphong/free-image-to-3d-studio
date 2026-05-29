from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

import numpy as np
import trimesh

try:
    import pymeshfix as _pymeshfix
    HAS_PYMESHFIX = True
except ImportError:
    HAS_PYMESHFIX = False


def _set_double_sided(mesh: trimesh.Trimesh) -> None:
    material = getattr(getattr(mesh, "visual", None), "material", None)
    if material is not None and hasattr(material, "doubleSided"):
        material.doubleSided = True


def _repair_mesh(mesh: trimesh.Trimesh, fill_passes: int = 3) -> None:
    """In-place: remove bad faces → stable-iterate hole fill → stitch open seams → fix normals."""
    try:
        mesh.update_faces(mesh.nondegenerate_faces())
        mesh.update_faces(mesh.unique_faces())
    except Exception:
        mesh.remove_degenerate_faces()
        mesh.remove_duplicate_faces()
    prev_faces = -1
    for _ in range(fill_passes):
        if mesh.is_watertight:
            break
        cur = len(mesh.faces)
        if cur == prev_faces:
            break
        prev_faces = cur
        trimesh.repair.fill_holes(mesh)
    # stitch_boundaries connects nearby open boundary edges (closes seam-type gaps)
    try:
        trimesh.repair.stitch_boundaries(mesh)
        trimesh.repair.fill_holes(mesh)
    except Exception:
        pass
    trimesh.repair.fix_normals(mesh)


def _fan_fill_holes(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Fill remaining open boundary loops via centroid fan triangulation.

    Detects every open boundary loop (edges appearing in exactly one face), places a
    centroid vertex at the loop's centre, and stitches fan triangles to close the hole.
    Works for arbitrarily large or concave holes that ear-clipping misses.
    UV coordinates for new centroid vertices are averaged from the hole boundary.
    Returns a new Trimesh (or the original if watertight / nothing to do / error).
    """
    if mesh.is_watertight:
        return mesh
    try:
        # Boundary edges appear in exactly one face
        edge_face_counts = np.bincount(
            mesh.faces_unique_edges.ravel(),
            minlength=len(mesh.edges_unique),
        )
        boundary_mask = edge_face_counts == 1
        if not boundary_mask.any():
            return mesh

        from collections import defaultdict
        adj: dict[int, list[int]] = defaultdict(list)
        for a, b in mesh.edges_unique[boundary_mask].tolist():
            adj[a].append(b)
            adj[b].append(a)

        # Walk boundary adjacency to extract closed loops
        visited: set[int] = set()
        loops: list[list[int]] = []
        for start in list(adj):
            if start in visited:
                continue
            loop: list[int] = []
            curr, prev = start, -1
            while curr not in visited:
                visited.add(curr)
                loop.append(curr)
                nxt = [n for n in adj[curr] if n != prev]
                if not nxt:
                    break
                prev, curr = curr, nxt[0]
            if len(loop) >= 3:
                loops.append(loop)

        if not loops:
            return mesh

        old_verts = mesh.vertices.copy()
        new_verts = old_verts.tolist()
        new_faces = mesh.faces.tolist()

        uv_src = getattr(getattr(mesh, "visual", None), "uv", None)
        has_uv = uv_src is not None and len(uv_src) == len(old_verts)
        new_uv = uv_src.tolist() if has_uv else None

        for loop in loops:
            centroid = old_verts[loop].mean(axis=0)
            c_idx = len(new_verts)
            new_verts.append(centroid.tolist())
            if has_uv:
                new_uv.append(uv_src[loop].mean(axis=0).tolist())
            n = len(loop)
            for i in range(n):
                new_faces.append([c_idx, loop[i], loop[(i + 1) % n]])

        result = trimesh.Trimesh(
            vertices=np.array(new_verts, dtype=np.float64),
            faces=np.array(new_faces, dtype=np.int64),
            process=False,
        )
        if has_uv:
            try:
                result.visual = trimesh.visual.TextureVisuals(
                    uv=np.array(new_uv, dtype=np.float32),
                    material=mesh.visual.material,
                )
            except Exception:
                result.visual = mesh.visual
        else:
            result.visual = mesh.visual
        trimesh.repair.fix_normals(result)
        return result
    except Exception:
        return mesh


def _pymeshfix_repair(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    """Watertight repair via PyMeshFix. UV coordinates are transferred to new vertices
    using nearest-neighbour lookup against original vertex positions.
    A trimesh cleanup pass runs after PyMeshFix to close any tiny gaps it left behind."""
    mf = _pymeshfix.MeshFix(mesh.vertices.copy(), mesh.faces.copy())
    mf.repair(joincomp=True, remove_smallest_components=False)

    if len(mf.v) == 0 or len(mf.f) == 0:
        return mesh

    repaired = trimesh.Trimesh(vertices=mf.v, faces=mf.f, process=False)

    # For each vertex in the repaired mesh, find the nearest vertex in the original
    # and copy its UV. New vertices added by PyMeshFix (hole fills) inherit the UV
    # of their closest existing neighbour, which is typically the right colour.
    try:
        visual = mesh.visual
        uv = getattr(visual, "uv", None)
        if uv is not None and len(uv) == len(mesh.vertices):
            try:
                from scipy.spatial import cKDTree
                _, idx = cKDTree(mesh.vertices).query(repaired.vertices, k=1)
            except ImportError:
                diff = repaired.vertices[:, np.newaxis, :] - mesh.vertices[np.newaxis, :, :]
                idx = np.einsum("ijk,ijk->ij", diff, diff).argmin(axis=1)
            repaired.visual = trimesh.visual.TextureVisuals(
                uv=uv[idx],
                material=visual.material,
            )
        else:
            repaired.visual = visual
    except Exception:
        repaired.visual = mesh.visual

    # Extra trimesh pass: PyMeshFix can leave small open edges — close them now
    trimesh.repair.fill_holes(repaired)
    trimesh.repair.fix_normals(repaired)

    return repaired


def _patch_glb_double_sided(path: Path) -> None:
    """Directly patch the GLTF JSON inside the GLB to set doubleSided=true on every
    material. This is more reliable than trimesh's material API because it operates on
    the serialized output and works regardless of trimesh's internal material type."""
    try:
        data = path.read_bytes()
        magic = struct.unpack_from("<I", data, 0)[0]
        if magic != 0x46546C67:  # 'glTF'
            return
        json_len = struct.unpack_from("<I", data, 12)[0]
        raw_json = data[20 : 20 + json_len].rstrip(b"\x00 ")
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
        file_header = struct.pack("<III", magic, version, new_total)
        chunk_header = struct.pack("<II", len(new_json_padded), 0x4E4F534A)  # 'JSON'
        tail = data[20 + json_len :]  # binary chunk (if any)
        path.write_bytes(file_header + chunk_header + new_json_padded + tail)
    except Exception:
        pass


def _select_components(
    components: list[trimesh.Trimesh],
    *,
    min_area_ratio: float,
    keep_area_ratio: float,
    min_faces: int,
) -> tuple[list[trimesh.Trimesh], float]:
    valid = [
        component
        for component in components
        if component.area > 0 and len(component.faces) >= min_faces
    ]
    if not valid:
        return ([max(components, key=lambda component: component.area)], 1.0) if components else ([], 0.0)

    ordered = sorted(valid, key=lambda component: component.area, reverse=True)
    total_area = sum(component.area for component in ordered) or 1.0
    min_area = total_area * min_area_ratio

    selected: list[trimesh.Trimesh] = []
    selected_ids: set[int] = set()

    for component in ordered:
        if component.area >= min_area:
            selected.append(component)
            selected_ids.add(id(component))

    covered_area = sum(component.area for component in selected)
    for component in ordered:
        if covered_area / total_area >= keep_area_ratio:
            break
        if id(component) in selected_ids:
            continue
        selected.append(component)
        selected_ids.add(id(component))
        covered_area += component.area

    return selected, covered_area / total_area


def clean_glb(
    input_path: Path,
    output_path: Path,
    min_area_ratio: float,
    keep_area_ratio: float,
    min_faces: int,
    double_sided: bool,
    drop_lower_ratio: float,
) -> tuple[int, int, float]:
    scene = trimesh.load(input_path, force="scene")
    cleaned = trimesh.Scene()
    total_components = 0
    kept_components = 0
    kept_area_ratios: list[float] = []
    bounds = scene.bounds
    lower_cutoff = None
    if bounds is not None and drop_lower_ratio > 0:
        lower_cutoff = bounds[0][1] + (bounds[1][1] - bounds[0][1]) * drop_lower_ratio

    for name, geometry in scene.geometry.items():
        # Repair the full geometry BEFORE splitting so boundary connectivity is intact.
        # Splitting first would create new artificial open edges at split seams.
        _repair_mesh(geometry, fill_passes=2)
        if not geometry.is_watertight and HAS_PYMESHFIX:
            geometry = _pymeshfix_repair(geometry)

        components = geometry.split(only_watertight=False)
        total_components += len(components)
        keep, kept_area_ratio = _select_components(
            components,
            min_area_ratio=min_area_ratio,
            keep_area_ratio=keep_area_ratio,
            min_faces=min_faces,
        )
        if lower_cutoff is not None:
            keep = [component for component in keep if component.bounds[1][1] >= lower_cutoff]
        kept_area_ratios.append(kept_area_ratio)

        for index, component in enumerate(keep):
            # Second repair pass per component after split
            _repair_mesh(component, fill_passes=3)
            # PyMeshFix: topology-level watertight repair
            if not component.is_watertight and HAS_PYMESHFIX:
                component = _pymeshfix_repair(component)
            # Fan fill: close any boundary loops that ear-clipping and PyMeshFix missed
            if not component.is_watertight:
                component = _fan_fill_holes(component)
                # One final PyMeshFix pass to clean up fan-fill seams
                if not component.is_watertight and HAS_PYMESHFIX:
                    component = _pymeshfix_repair(component)
            if double_sided:
                _set_double_sided(component)
            cleaned.add_geometry(component, node_name=f"{name}_{index}")
        kept_components += len(keep)

    cleaned.export(output_path)
    _patch_glb_double_sided(output_path)
    average_area_ratio = sum(kept_area_ratios) / len(kept_area_ratios) if kept_area_ratios else 0.0
    return total_components, kept_components, average_area_ratio


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input_path", type=Path)
    parser.add_argument("output_path", type=Path)
    parser.add_argument("--min-area-ratio", type=float, default=0.025)
    parser.add_argument("--keep-area-ratio", type=float, default=0.985)
    parser.add_argument("--min-faces", type=int, default=1)
    parser.add_argument("--drop-lower-ratio", type=float, default=0.0)
    parser.add_argument("--single-sided", action="store_true")
    args = parser.parse_args()

    total, kept, kept_area_ratio = clean_glb(
        args.input_path,
        args.output_path,
        args.min_area_ratio,
        args.keep_area_ratio,
        args.min_faces,
        not args.single_sided,
        args.drop_lower_ratio,
    )
    print(f"Cleaned GLB components: kept {kept}/{total}, area {kept_area_ratio:.1%}")


if __name__ == "__main__":
    main()
