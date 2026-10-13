"""Export web assets from the Genlixs v2 logo package (13 Oct 2026).

Three of the four supplied masters are RGB with a baked #101211 background.
They are converted to transparent PNGs with a colour-to-alpha pass against
that exact background colour (GIMP's algorithm), so the artwork itself is not
redrawn or recoloured. The dark variant is already RGBA and is only trimmed.
"""
import os
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
BG = np.array([16, 18, 17], np.float32) / 255.0  # sampled corner colour


def color_to_alpha(rgb: Image.Image) -> Image.Image:
    a = np.asarray(rgb.convert("RGB"), np.float32) / 255.0
    b = BG[None, None, :]
    # per-channel alpha needed to explain the pixel as fg over bg
    up = np.where(a > b, (a - b) / (1.0 - b), 0)
    down = np.where(a < b, (b - a) / b, 0)
    alpha = np.max(np.maximum(up, down), axis=2)
    alpha = np.clip(alpha, 0, 1)
    safe = np.maximum(alpha, 1e-6)[..., None]
    fg = (a - b) / safe + b
    fg = np.clip(fg, 0, 1)
    alpha = np.where(alpha < 0.02, 0, alpha)  # kill compression noise in the field
    out = np.dstack([fg, alpha[..., None]])
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA")


def trim(im: Image.Image, pad: int) -> Image.Image:
    bbox = im.getchannel("A").point(lambda v: 255 if v > 12 else 0).getbbox()
    return im.crop((bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad))


def save_sizes(im: Image.Image, name: str, widths=(480, 960)):
    for w in widths:
        h = round(im.height * w / im.width)
        r = im.resize((w, h), Image.LANCZOS)
        r.save(os.path.join(OUT, f"{name}-{w}.png"), optimize=True)
        r.save(os.path.join(OUT, f"{name}-{w}.webp"), quality=92, method=6)
    print(name, im.size, "ratio", round(im.width / im.height, 4))


def downscale(path: str, factor: int = 4) -> Image.Image:
    im = Image.open(path)
    return im.resize((im.width // factor, im.height // factor), Image.LANCZOS)


variants = {
    "Website-header-logo.png": "genlixs-header-white",
    "white-logo.png": "genlixs-logo-color",
    "Full white-logo.png": "genlixs-logo-mono-white",
}
cut = {}
for src, name in variants.items():
    small = downscale(os.path.join(SRC, src))  # 5042 x 1121 working size keeps memory sane
    rgba = trim(color_to_alpha(small), 10)
    cut[name] = rgba
    save_sizes(rgba, name)

dark = downscale(os.path.join(SRC, "dark-logo.png")).convert("RGBA")
dark = trim(dark, 10)
cut["genlixs-logo-dark"] = dark
save_sizes(dark, "genlixs-logo-dark")

# Symbols: the mark sits left of the first wide transparent gap.
def symbol(im: Image.Image) -> Image.Image:
    a = np.asarray(im.getchannel("A")) > 20
    cols = a.any(axis=0)
    x = 0
    while x < len(cols) and not cols[x]:
        x += 1
    start = x
    gap = 0
    while x < len(cols):
        if cols[x]:
            gap = 0
        else:
            gap += 1
            if gap > im.height * 0.08:
                break
        x += 1
    sym = im.crop((start, 0, x - gap, im.height))
    return sym.crop(sym.getchannel("A").point(lambda v: 255 if v > 12 else 0).getbbox())


def square(sym: Image.Image, size: int, pad: float, bg=None) -> Image.Image:
    side = round(max(sym.size) * (1 + 2 * pad))
    canvas = Image.new("RGBA", (side, side), bg or (0, 0, 0, 0))
    canvas.alpha_composite(sym, ((side - sym.width) // 2, (side - sym.height) // 2))
    return canvas.resize((size, size), Image.LANCZOS)


sym_color = symbol(cut["genlixs-logo-color"])
sym_tile = symbol(cut["genlixs-header-white"])
print("symbol color", sym_color.size, "tile", sym_tile.size)
square(sym_color, 512, 0.06).save(os.path.join(OUT, "genlixs-symbol-color-512.png"), optimize=True)
square(sym_color, 64, 0.04).save(os.path.join(OUT, "genlixs-symbol-color-64.png"), optimize=True)
square(sym_tile, 64, 0.02).save(os.path.join(OUT, "genlixs-symbol-tile-64.png"), optimize=True)
square(sym_tile, 512, 0.04).save(os.path.join(OUT, "genlixs-symbol-tile-512.png"), optimize=True)
square(sym_color, 256, 0.04).save(os.path.join(OUT, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
square(sym_color, 512, 0.06).save(os.path.join(OUT, "icon.png"), optimize=True)
square(sym_color, 180, 0.18, bg=(15, 18, 18, 255)).save(os.path.join(OUT, "apple-icon.png"), optimize=True)

# Open Graph: supplied colour logo on the night canvas, lime + blue palette rule.
og = Image.new("RGBA", (1200, 630), (15, 18, 18, 255))
glow = np.zeros((630, 1200, 4), np.float32)
yy, xx = np.mgrid[0:630, 0:1200].astype(np.float32)
d = np.sqrt(((xx - 860) / 520) ** 2 + ((yy - 140) / 300) ** 2)
glow[..., 0], glow[..., 1], glow[..., 2] = 37, 63, 246
glow[..., 3] = np.clip(1 - d, 0, 1) ** 2 * 120
og.alpha_composite(Image.fromarray(glow.astype(np.uint8), "RGBA"))
logo = cut["genlixs-logo-color"]
lw = 640
logo = logo.resize((lw, round(logo.height * lw / logo.width)), Image.LANCZOS)
og.alpha_composite(logo, ((1200 - lw) // 2, (630 - logo.height) // 2 - 24))
bar_y = 430
for i, c in enumerate([(225, 255, 1), (37, 63, 246), (255, 255, 255)]):
    og.paste(Image.new("RGBA", (72, 8), c + (255,)), (1200 // 2 - 120 + i * 84, bar_y))
og.convert("RGB").save(os.path.join(OUT, "opengraph-image.png"), optimize=True)
print("done")
