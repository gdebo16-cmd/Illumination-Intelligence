"""
Turns the extra Flicker shapes (droplet, leaf, star, stone, umbra) into white, see-through pictures for the app.

Each design starts as a picture on a plain black background in assets/flicker-designs/<id>.png
(painted by Prism's Masterpiece model from the violet flame, so they share its art style).
This script:
  1. makes the black background see-through (the same way make-flame-sprites.py does),
     and turns the design white, keeping its shading, so the app can tint it any color,
  2. trims the empty space and centres the design in the same picture shape the flames use,
  3. saves it as public/umbra/flames/<id>.png.

These designs are still pictures: they have no animation yet.

Run it from apps/suite with ComfyUI's Python (it has the picture tools installed):
    C:\\Users\\gdebo\\AI\\ComfyUI_windows_portable\\python_embeded\\python.exe -I scripts\\make-flicker-designs.py

To add a design: put <id>.png in assets/flicker-designs, add the id to DESIGNS below and to
DESIGNS in config/umbra.ts, then run this again.
"""
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "assets", "flicker-designs")
OUT = os.path.join(ROOT, "public", "umbra", "flames")
MANIFEST = os.path.join(ROOT, "config", "umbra-flame-clips.json")

DESIGNS = ["droplet", "leaf", "star", "stone", "umbra"]

SCALE = 2      # saved at twice the flames' size so they stay sharp on phone screens
HAZE = 7.0     # how far above pure black still counts as background
SEEN = 20.0    # how bright a pixel must be to count as part of the design
FILL = 0.9     # the design fills this much of the picture; the rest is empty margin


def unscreen(rgb: np.ndarray) -> np.ndarray:
    """Black background -> transparent; glow -> partly transparent; bright parts -> solid.

    The colour is thrown away: every pixel becomes a shade between light grey and white
    (darker where the design was a deeper colour), like the white "pearl" flame. The app
    then multiplies that by the color you picked.
    """
    lifted = np.clip((rgb - HAZE) / (255.0 - HAZE), 0.0, 1.0)
    alpha = lifted.max(axis=-1, keepdims=True)
    colour = np.where(alpha > 1e-3, lifted / np.maximum(alpha, 1e-3), 0.0)
    light = (colour * np.array([0.299, 0.587, 0.114], dtype=np.float32)).sum(axis=-1, keepdims=True)
    seen = light[alpha > 0.2]
    low, high = np.percentile(seen, 5), np.percentile(seen, 95)
    shade = 0.6 + 0.4 * np.clip((light - low) / max(high - low, 1e-3), 0.0, 1.0)
    white = np.repeat(shade, 3, axis=-1)
    return (np.concatenate([white, alpha], axis=-1) * 255.0 + 0.5).astype(np.uint8)

def main() -> int:
    with open(MANIFEST, encoding="utf-8") as f:
        shape = json.load(f)
    box_w, box_h = shape["width"] * SCALE, shape["height"] * SCALE

    for name in DESIGNS:
        path = os.path.join(SOURCE, f"{name}.png")
        if not os.path.exists(path):
            print(f"Missing {path}")
            return 1
        rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
        lit = rgb.max(axis=-1) > SEEN
        ys, xs = np.where(lit.any(axis=1))[0], np.where(lit.any(axis=0))[0]
        art = Image.fromarray(unscreen(rgb[ys.min():ys.max() + 1, xs.min():xs.max() + 1]), "RGBA")
        fit = min(box_w * FILL / art.width, box_h * FILL / art.height)
        art = art.resize((round(art.width * fit), round(art.height * fit)), Image.LANCZOS)
        picture = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
        picture.paste(art, ((box_w - art.width) // 2, (box_h - art.height) // 2))
        out = os.path.join(OUT, f"{name}.png")
        picture.save(out, optimize=True)
        print(f"{name}: {box_w} x {box_h}, {os.path.getsize(out) / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
