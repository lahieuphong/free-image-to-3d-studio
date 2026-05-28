from __future__ import annotations

from pathlib import Path

from PIL import Image


def preprocess_image(
    input_path: Path,
    output_path: Path,
    foreground_ratio: float = 0.85,
) -> None:
    """
    1. Remove background with rembg (BiRefNet model — much better than u2net).
    2. Crop to object bounding box, then center-pad to a square canvas so the
       object occupies exactly `foreground_ratio` of the frame.
    3. Save as RGBA PNG.  SF3D should then be called with --no-remove-bg so it
       uses this clean alpha channel instead of running its own (weaker) removal.
    """
    import rembg

    img = Image.open(input_path).convert("RGBA")

    try:
        session = rembg.new_session("birefnet-general")
    except Exception:
        session = rembg.new_session("isnet-general-use")

    rgba = rembg.remove(
        img,
        session=session,
        alpha_matting=True,
        alpha_matting_foreground_threshold=240,
        alpha_matting_background_threshold=10,
        alpha_matting_erode_size=10,
    )

    alpha = rgba.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        rgba.save(output_path)
        return

    obj = rgba.crop(bbox)
    obj_w, obj_h = obj.size
    long_side = max(obj_w, obj_h)

    # Expand canvas so the object fills exactly foreground_ratio of the square.
    canvas_size = max(int(round(long_side / foreground_ratio)), 1)

    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    paste_x = (canvas_size - obj_w) // 2
    paste_y = (canvas_size - obj_h) // 2
    canvas.paste(obj, (paste_x, paste_y), mask=obj)

    canvas.save(output_path)
