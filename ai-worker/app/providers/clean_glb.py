from __future__ import annotations

import argparse
from pathlib import Path

import trimesh


def _set_double_sided(mesh: trimesh.Trimesh) -> None:
    material = getattr(getattr(mesh, "visual", None), "material", None)
    if material is not None and hasattr(material, "doubleSided"):
        material.doubleSided = True


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
            trimesh.repair.fill_holes(component)
            if double_sided:
                _set_double_sided(component)
            cleaned.add_geometry(component, node_name=f"{name}_{index}")
        kept_components += len(keep)

    cleaned.export(output_path)
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
