"""Cuts assets/flames.mp4 into eight animated flame avatars for Umbra.

The video is a 4 x 2 grid of flame spirits on a flat dark background. For each one this:
  1. crops its cell from every frame,
  2. removes the background and turns the glow into real transparency
     (bright = solid, dark = see-through), so the flame floats over anything,
  3. saves public/umbra/flames/<id>.webp (animated) and <id>.png (still, first frame).

Needs Python with PyAV, numpy and Pillow. ComfyUI's bundled Python has all three, so from apps/suite:

    C:\\Users\\gdebo\\AI\\ComfyUI_windows_portable\\python_embeded\\python.exe -I scripts\\make-flame-sprites.py
"""

import os
import sys

import av
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "assets", "flames.mp4")
OUT = os.path.join(ROOT, "public", "umbra", "flames")

# Cell positions found by scanning the video (x0, x1) per column and (y0, y1) per row, plus margin.
COLUMNS = [(19, 136), (175, 293), (331, 448), (489, 607)]
ROWS = [(32, 205), (276, 449)]
MARGIN = 8

# Keep every Nth frame. 2 = 12 frames per second: still smooth for a gentle bob, half the file size.
FRAME_STEP = 2

# Left to right, top row then bottom row.
FLAMES = ["violet", "cyan", "amber", "jade", "rose", "ember", "azure", "pearl"]


# The video's background isn't perfectly even. Anything within this many levels of it counts as
# background, so no faint rectangle shows around a flame.
HAZE = 7.0


def unscreen(rgb: np.ndarray, background: np.ndarray) -> np.ndarray:
    """Dark background -> transparent; glow -> partly transparent; bright core -> solid."""
    floor = background + HAZE
    lifted = np.clip((rgb - floor) / (255.0 - floor), 0.0, 1.0)
    alpha = lifted.max(axis=-1, keepdims=True)
    colour = np.where(alpha > 1e-3, lifted / np.maximum(alpha, 1e-3), 0.0)
    rgba = np.concatenate([colour, alpha], axis=-1)
    return (rgba * 255.0 + 0.5).astype(np.uint8)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    container = av.open(SRC)
    stream = container.streams.video[0]
    fps = float(stream.average_rate or 24)
    frames = [f.to_ndarray(format="rgb24").astype(np.float32) for f in container.decode(video=0)]
    background = frames[0][:8, :8].reshape(-1, 3).mean(axis=0)
    frames = frames[::FRAME_STEP]
    duration_ms = int(round(1000.0 * FRAME_STEP / fps))
    height, width = frames[0].shape[:2]

    for index, name in enumerate(FLAMES):
        (x0, x1), (y0, y1) = COLUMNS[index % 4], ROWS[index // 4]
        x0, y0 = max(0, x0 - MARGIN), max(0, y0 - MARGIN)
        x1, y1 = min(width, x1 + MARGIN + 1), min(height, y1 + MARGIN + 1)

        images = [Image.fromarray(unscreen(f[y0:y1, x0:x1], background), "RGBA") for f in frames]
        images[0].save(os.path.join(OUT, f"{name}.png"))
        images[0].save(
            os.path.join(OUT, f"{name}.webp"),
            save_all=True,
            append_images=images[1:],
            duration=duration_ms,
            loop=0,
            quality=72,
            alpha_quality=70,
            method=4,
            minimize_size=True,
        )
        size_kb = os.path.getsize(os.path.join(OUT, f"{name}.webp")) / 1024
        print(f"{name}: {x1 - x0}x{y1 - y0}, {len(images)} frames, {size_kb:.0f} KB")


if __name__ == "__main__":
    sys.exit(main())
