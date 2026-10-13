"""Resize the selected client images (Genlixs Drive) into public/media/client/*.webp.

Usage: python3 -I brand/client_media.py <webp_dir> <png_dir> <out_dir>
  webp_dir  folder with the Drive "IMAGES" *_min.webp files
  png_dir   folder with the Drive "IMAGES" *.png files
  out_dir   public/media/client

Selection and exclusions are recorded in design-handoff/genlixs/CLIENT_MEDIA.md.
The clip was re-encoded separately (muted H.264, faststart) with ffmpeg:
  ffmpeg -i "generation (19).mp4" -an -c:v libx264 -preset slow -crf 25 -pix_fmt yuv420p \
         -profile:v high -movflags +faststart knight-clip.mp4
  ffmpeg -ss 1.2 -i knight-clip.mp4 -frames:v 1 poster.png  (then saved as WebP q80)
"""
import sys, glob, os
from PIL import Image
raw, pngs, out = sys.argv[1], sys.argv[2], sys.argv[3]
PICK = [
  ("forest-flare", raw, "82e86e0d"),
  ("sea-gown", raw, "fe919aa0"),
  ("milky-tent", raw, "44ae4a3b"),
  ("summit-bag", raw, "ab620e90"),
  ("library", raw, "4a62c1ec"),
  ("boardwalk", raw, "c008fe31"),
  ("garden", raw, "87cf70aa"),
  ("stone-hall", raw, "b743de53"),
  ("horned", raw, "fabb4274"),
  ("trench", raw, "cde2c409"),
  ("earring", raw, "38b13fe8"),
  ("warrior-sheet", raw, "82e0c44d"),
  ("drive-thru", pngs, "2fffeb2c"),
  ("sofa", pngs, "b6e9ad37"),
]
LONG = 1600
for name, d, key in PICK:
    src = glob.glob(os.path.join(d, "*" + key + "*"))[0]
    im = Image.open(src).convert("RGB")
    w, h = im.size
    s = min(1.0, LONG / max(w, h))
    if s < 1:
        im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
    p = os.path.join(out, name + ".webp")
    im.save(p, "WEBP", quality=78, method=6)
    print(f"{name:14} {w}x{h} -> {im.width}x{im.height} {os.path.getsize(p)//1024}KB")
