"""Cuts the flicker videos into see-through animated avatars for Umbra.

Each video is one clip holding all eight flickers in a 4 x 2 grid on a black background,
with a name label under each one:

    assets/flicker-idle.mp4    resting (needed)
    assets/flicker-dance.mp4   dancing, shown while a bot is working (optional; add it when it exists)

For each flicker in each video this:
  1. crops its cell from every frame (the same box for every flicker and both videos,
     so a flicker never changes size when it switches from resting to dancing),
  2. removes the black and turns the glow into real transparency
     (bright = solid, dark = see-through), so the flicker floats over anything,
  3. saves into public/umbra/flames/:
       <id>.png          still picture (first resting frame)
       <id>.avif         resting animation: small, what phones load
       <id>.webp         the same for older browsers: bigger and half the frames
       <id>-dance.avif / <id>-dance.webp   only when the dance video exists
  4. writes config/umbra-flame-clips.json, which tells the app the picture shape
     and which flickers have a dance clip.

Needs Python with PyAV, numpy and Pillow 11.3 or newer. ComfyUI's bundled Python has all three,
so from apps/suite:

    C:\\Users\\gdebo\\AI\\ComfyUI_windows_portable\\python_embeded\\python.exe -I scripts\\make-flame-sprites.py
"""

import json
import os
import sys

import av
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ASSETS = os.path.join(ROOT, "assets")
OUT = os.path.join(ROOT, "public", "umbra", "flames")
MANIFEST = os.path.join(ROOT, "config", "umbra-flame-clips.json")

# clip name -> (video file, ending added to the picture names)
CLIPS = {
    "idle": ("flicker-idle.mp4", ""),
    "dance": ("flicker-dance.mp4", "-dance"),
}

# Left to right, top row then bottom row. These ids are saved with each bot, so they stay the
# same even though the video's labels say Mint / Coral / Sapphire for jade / ember / azure.
FLAMES = ["violet", "cyan", "amber", "jade", "rose", "ember", "azure", "pearl"]
GRID_COLUMNS, GRID_ROWS = 4, 2
# The bottom of each grid cell holds the name label; only this much of the cell (from the top) is flicker.
CELL_ART_HEIGHT = 0.91

MARGIN = 8          # empty pixels kept around the flickers
SEEN = 20.0         # how much brighter than the background counts as "part of a flicker"
# Compression noise makes the black slightly uneven. Anything within this many levels of it counts
# as background, so no faint rectangle shows around a flicker.
HAZE = 7.0
LOOP_BLEND = 4      # the last few frames ease back into the first one, so the loop has no hitch
AVIF_QUALITY = 50   # about 90 KB per flicker at the full 24 frames per second
WEBP_FRAME_STEP = 2  # the older-browser copy keeps every 2nd frame
WEBP_QUALITY = 55


def read_frames(path: str) -> tuple[list[np.ndarray], float]:
    container = av.open(path)
    stream = container.streams.video[0]
    fps = float(stream.average_rate or 24)
    frames = [f.to_ndarray(format="rgb24").astype(np.float32) for f in container.decode(video=0)]
    container.close()
    return frames, fps


def cells(width: int, height: int) -> list[tuple[int, int, int, int]]:
    """Each flicker's part of the frame as (x0, y0, x1, y1), label strip left out."""
    cell_w, cell_h = width // GRID_COLUMNS, height // GRID_ROWS
    art_h = int(cell_h * CELL_ART_HEIGHT)
    return [
        (col * cell_w, row * cell_h, (col + 1) * cell_w, row * cell_h + art_h)
        for row in range(GRID_ROWS)
        for col in range(GRID_COLUMNS)
    ]


def unscreen(rgb: np.ndarray, background: np.ndarray) -> np.ndarray:
    """Black background -> transparent; glow -> partly transparent; bright core -> solid."""
    floor = background + HAZE
    lifted = np.clip((rgb - floor) / (255.0 - floor), 0.0, 1.0)
    alpha = lifted.max(axis=-1, keepdims=True)
    colour = np.where(alpha > 1e-3, lifted / np.maximum(alpha, 1e-3), 0.0)
    rgba = np.concatenate([colour, alpha], axis=-1)
    return (rgba * 255.0 + 0.5).astype(np.uint8)


def main() -> int:
    videos = {}
    for clip, (filename, _) in CLIPS.items():
        path = os.path.join(ASSETS, filename)
        if os.path.exists(path):
            videos[clip] = read_frames(path)
    if "idle" not in videos:
        print(f"Missing {os.path.join(ASSETS, CLIPS['idle'][0])}")
        return 1
    sizes = {frames[0].shape[:2] for frames, _ in videos.values()}
    if len(sizes) > 1:
        print("The videos must all be the same width and height, with the flickers in the same grid.")
        return 1
    height, width = sizes.pop()
    grid = cells(width, height)
    cell_w, cell_h = grid[0][2] - grid[0][0], grid[0][3] - grid[0][1]

    # One crop box for everything: the smallest box (inside a cell) that holds every flicker
    # in every frame of every video.
    used = np.zeros((cell_h, cell_w), dtype=bool)
    backgrounds = {}
    for clip, (frames, _) in videos.items():
        backgrounds[clip] = frames[0][:8, :8].reshape(-1, 3).mean(axis=0)
        brightest = np.max(np.stack([f.max(axis=-1) for f in frames]), axis=0)
        lit = brightest > backgrounds[clip].max() + SEEN
        for x0, y0, x1, y1 in grid:
            used |= lit[y0:y1, x0:x1]
    ys, xs = np.where(used.any(axis=1))[0], np.where(used.any(axis=0))[0]
    bx0, bx1 = max(0, xs.min() - MARGIN), min(cell_w, xs.max() + MARGIN + 1)
    by0, by1 = max(0, ys.min() - MARGIN), min(cell_h, ys.max() + MARGIN + 1)
    box_w, box_h = bx1 - bx0, by1 - by0
    print(f"Picture size: {box_w} x {box_h}")

    os.makedirs(OUT, exist_ok=True)
    for clip, (frames, fps) in videos.items():
        suffix = CLIPS[clip][1]
        # Ease the tail of the clip into its first frame so it loops smoothly.
        blend = min(LOOP_BLEND, len(frames) - 1)
        for i in range(blend):
            weight = (i + 1) / (blend + 1)
            index = len(frames) - blend + i
            frames[index] = frames[index] * (1 - weight) + frames[0] * weight

        for (x0, y0, _, _), name in zip(grid, FLAMES):
            images = [
                Image.fromarray(unscreen(f[y0 + by0:y0 + by1, x0 + bx0:x0 + bx1], backgrounds[clip]), "RGBA")
                for f in frames
            ]
            if clip == "idle":
                images[0].save(os.path.join(OUT, f"{name}.png"), optimize=True)

            avif = os.path.join(OUT, f"{name}{suffix}.avif")
            images[0].save(
                avif, save_all=True, append_images=images[1:],
                duration=int(round(1000.0 / fps)), loop=0, quality=AVIF_QUALITY, speed=4,
            )
            fewer = images[::WEBP_FRAME_STEP]
            webp = os.path.join(OUT, f"{name}{suffix}.webp")
            fewer[0].save(
                webp, save_all=True, append_images=fewer[1:],
                duration=int(round(1000.0 * WEBP_FRAME_STEP / fps)), loop=0,
                quality=WEBP_QUALITY, alpha_quality=70, method=4, minimize_size=True,
            )
            print(
                f"{name}{suffix}: {len(images)} frames, "
                f"avif {os.path.getsize(avif) / 1024:.0f} KB, webp {os.path.getsize(webp) / 1024:.0f} KB"
            )

    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump({"width": int(box_w), "height": int(box_h), "dance": FLAMES if "dance" in videos else []}, f, indent=2)
        f.write("\n")
    print(f"Wrote {os.path.relpath(MANIFEST, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
