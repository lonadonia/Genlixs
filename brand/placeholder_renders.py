"""Brand-v2 placeholder renders (SDF ray-marching in NumPy).

TEMPORARY media for the design preview only: abstract 3D pieces in the v2 palette
(Night #0F1212, Lime #E1FF01, White, Electric Blue #253FF6). They hold layout space
until the client's approved images/videos replace them via src/lib/media.ts.

Usage: python3 placeholder_renders.py <out_dir> [still|video|all]
"""
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageFilter

OUT = sys.argv[1]
WHICH = sys.argv[2] if len(sys.argv) > 2 else "all"
os.makedirs(OUT, exist_ok=True)

LIME = np.array([225, 255, 1], np.float32) / 255
BLUE = np.array([37, 63, 246], np.float32) / 255
WHITE = np.array([0.93, 0.94, 0.93], np.float32)
NIGHT = np.array([15, 18, 18], np.float32) / 255
CHROME = np.array([0.75, 0.78, 0.8], np.float32)


def norm(v):
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-8)


def rot_x(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], np.float32)


def rot_z(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], np.float32)


def rot_y(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], np.float32)


# ------------------------------------------------------------------ SDF primitives
def sd_sphere(p, c, r):
    return np.linalg.norm(p - c, axis=-1) - r


def sd_torus(p, c, R, r, m):
    q = (p - c) @ m.T
    xz = np.sqrt(q[..., 0] ** 2 + q[..., 2] ** 2) - R
    return np.sqrt(xz ** 2 + q[..., 1] ** 2) - r


def sd_capsule(p, a, b, r):
    pa, ba = p - a, b - a
    h = np.clip(np.sum(pa * ba, -1) / np.dot(ba, ba), 0, 1)[..., None]
    return np.linalg.norm(pa - ba * h, axis=-1) - r


def sd_plane(p):
    return p[..., 1]


class Scene:
    """objects: list of (sdf_fn, material dict). Floor is material 0."""

    def __init__(self, objects, floor=True):
        self.objects = objects
        self.floor = floor

    def dist(self, p):
        d = sd_plane(p) if self.floor else np.full(p.shape[:-1], 1e3, np.float32)
        mid = np.zeros(p.shape[:-1], np.int8)
        for i, (fn, _) in enumerate(self.objects, start=1):
            di = fn(p)
            closer = di < d
            d = np.where(closer, di, d)
            mid = np.where(closer, i, mid)
        return d, mid


def march(scene, ro, rd, steps=110, tmax=40.0):
    t = np.zeros(rd.shape[:-1], np.float32)
    hit = np.zeros(rd.shape[:-1], bool)
    mid = np.full(rd.shape[:-1], -1, np.int8)
    active = np.ones(rd.shape[:-1], bool)
    for _ in range(steps):
        if not active.any():
            break
        p = ro + rd * t[..., None]
        d, m = scene.dist(p[active])
        ta = t[active]
        ta = ta + d * 0.9
        t[active] = ta
        h = d < 1e-3 * (1 + ta)
        idx = np.flatnonzero(active)
        hit[idx[h]] = True
        mid[idx[h]] = m[h]
        far = ta > tmax
        active[idx[h | far]] = False
    return t, hit, mid


def normal(scene, p):
    e = 1e-3
    ex = np.array([e, 0, 0], np.float32)
    ey = np.array([0, e, 0], np.float32)
    ez = np.array([0, 0, e], np.float32)
    n = np.stack(
        [
            scene.dist(p + ex)[0] - scene.dist(p - ex)[0],
            scene.dist(p + ey)[0] - scene.dist(p - ey)[0],
            scene.dist(p + ez)[0] - scene.dist(p - ez)[0],
        ],
        -1,
    )
    return norm(n)


def soft_shadow(scene, p, ld, k=10.0, steps=28):
    res = np.ones(p.shape[:-1], np.float32)
    t = np.full(p.shape[:-1], 0.02, np.float32)
    for _ in range(steps):
        d, _ = scene.dist(p + ld * t[..., None])
        res = np.minimum(res, np.clip(k * d / t, 0, 1))
        t = t + np.clip(d, 0.02, 0.4)
    return np.clip(res, 0, 1) ** 1.3


def ambient_occ(scene, p, n):
    occ = np.zeros(p.shape[:-1], np.float32)
    sca = 1.0
    for i in range(5):
        h = 0.02 + 0.12 * i
        d, _ = scene.dist(p + n * h)
        occ += (h - d) * sca
        sca *= 0.75
    return np.clip(1 - 2.2 * occ, 0, 1)


def env(rd, glow_dir):
    """Dark studio environment with an electric-blue glow and a faint lime kicker."""
    up = np.clip(rd[..., 1], -1, 1)
    base = NIGHT * (0.9 + 0.4 * np.clip(up, 0, 1)[..., None])
    g = np.clip(np.sum(rd * glow_dir, -1), 0, 1) ** 12
    lime_dir = norm(np.array([-0.8, 0.2, -0.3], np.float32))
    gl = np.clip(np.sum(rd * lime_dir, -1), 0, 1) ** 18
    return base + BLUE * (g * 0.55)[..., None] + LIME * (gl * 0.22)[..., None]


def aces(x):
    """Luminance-preserving Reinhard: keeps the lime and electric blue saturated."""
    lum = 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]
    scale = (1 / (1 + lum * 0.55))[..., None]
    return np.clip(x * scale * 1.12, 0, 1)


def render(scene, mats, w, h, cam, look, fov=0.55, key=(3.0, 6.5, -5.0), glow=(0.45, 0.3, 1.0), ss=1.0, seed=1):
    W, H = int(w * ss), int(h * ss)
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    aspect = W / H
    px = (x / W * 2 - 1) * aspect * fov
    py = -(y / H * 2 - 1) * fov
    ro = np.array(cam, np.float32)
    fwd = norm(np.array(look, np.float32) - ro)
    right = norm(np.cross(np.array([0, 1, 0], np.float32), fwd))
    up = np.cross(fwd, right)
    rd = norm(fwd[None, None] + px[..., None] * right + py[..., None] * up).reshape(-1, 3)
    ro_b = np.broadcast_to(ro, rd.shape).astype(np.float32)
    t, hit, mid = march(scene, ro_b, rd)
    glow_dir = norm(np.array(glow, np.float32))
    col = env(rd, glow_dir)
    p = ro_b + rd * t[..., None]
    if hit.any():
        ph = p[hit]
        n = normal(scene, ph)
        v = -rd[hit]
        lp = np.array(key, np.float32)
        ld = norm(lp - ph)
        sh = soft_shadow(scene, ph + n * 2e-3, ld)
        ao = ambient_occ(scene, ph, n)
        diff = np.clip(np.sum(n * ld, -1), 0, 1)
        hv = norm(ld + v)
        m = mid[hit]
        albedo = np.zeros_like(ph)
        rough = np.zeros(ph.shape[0], np.float32)
        metal = np.zeros(ph.shape[0], np.float32)
        for i, mat in enumerate(mats):
            sel = m == i
            albedo[sel] = mat["color"]
            rough[sel] = mat.get("rough", 0.4)
            metal[sel] = mat.get("metal", 0.0)
        spec_pow = 8 + (1 - rough) * 220
        spec = np.clip(np.sum(n * hv, -1), 0, 1) ** spec_pow * (0.25 + (1 - rough) * 1.4)
        fres = (1 - np.clip(np.sum(n * v, -1), 0, 1)) ** 4
        refl_dir = norm(rd[hit] - 2 * np.sum(rd[hit] * n, -1, keepdims=True) * n)
        envc = env(refl_dir, glow_dir)
        # rim from the electric glow + lime kicker
        rim = np.clip(np.sum(n * glow_dir, -1), 0, 1) ** 3
        lime_dir = norm(np.array([-0.8, 0.2, -0.3], np.float32))
        rim2 = np.clip(np.sum(n * lime_dir, -1), 0, 1) ** 6
        fill_dir = norm(np.array([-1.0, 0.6, -0.8], np.float32))
        fill = np.clip(np.sum(n * fill_dir, -1), 0, 1) * 0.28
        lit = albedo * (0.08 + 0.95 * diff * sh + fill)[..., None] * ao[..., None]
        lit = lit * (1 - metal[..., None]) + albedo * envc * 1.6 * metal[..., None]
        lit += (spec * sh)[..., None] * np.array([1, 1, 1], np.float32)
        lit += envc * ((fres * (0.25 + 0.75 * (1 - rough))) * ao)[..., None]
        lit += BLUE * (rim * 0.5 * ao)[..., None] + LIME * (rim2 * 0.18 * ao)[..., None]
        # floor fades into the environment with distance
        floor = m == 0
        if floor.any():
            fog = 1 - np.exp(-t[hit][floor] * 0.09)
            lit[floor] = lit[floor] * (1 - fog[..., None]) + env(rd[hit][floor], glow_dir) * fog[..., None]
        col[hit] = lit
    img = aces(col * 1.25).reshape(H, W, 3)
    # bloom
    pil = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    bright = np.clip(img - 0.72, 0, 1)
    bloom = np.asarray(Image.fromarray((bright * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(18 * ss)), np.float32) / 255
    img = np.clip(img + bloom * 0.6, 0, 1)
    if ss != 1:
        pil = Image.fromarray((img * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)
        img = np.asarray(pil, np.float32) / 255
    # vignette + grain
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dv = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    img = img * (1 - 0.35 * np.clip((dv - 0.6) / 0.9, 0, 1) ** 2)[..., None]
    rng = np.random.default_rng(seed)
    img = img + rng.normal(0, 0.008, img.shape[:2]).astype(np.float32)[..., None]
    return np.clip(img, 0, 1)


def save(img, name, q=88):
    Image.fromarray((img * 255).astype(np.uint8)).save(os.path.join(OUT, name + ".jpg"), quality=q, optimize=True, progressive=True)
    print("saved", name)


# ------------------------------------------------------------------ scenes
def torus_scene(t=0.0):
    tm = rot_x(1.05 + 0.12 * np.sin(t)) @ rot_z(0.35) @ rot_y(t * 0.6)
    orbit = np.array([np.cos(t * 1.3) * 0.25, 1.55 + 0.05 * np.sin(t * 2), np.sin(t * 1.3) * 0.25], np.float32)
    objs = [
        (lambda p: sd_torus(p, np.array([0, 1.55, 0], np.float32), 1.15, 0.36, tm), {"color": BLUE, "rough": 0.18}),
        (lambda p: sd_sphere(p, orbit, 0.42), {"color": LIME, "rough": 0.35}),
        (lambda p: sd_sphere(p, np.array([1.75, 0.32, -0.6], np.float32), 0.32), {"color": WHITE, "rough": 0.12}),
        (lambda p: sd_sphere(p, np.array([-1.8, 0.22, 0.5], np.float32), 0.22), {"color": CHROME, "rough": 0.05, "metal": 1.0}),
    ]
    mats = [{"color": np.array([0.05, 0.055, 0.055], np.float32), "rough": 0.25}] + [o[1] for o in objs]
    return Scene(objs), mats


def pills_scene():
    objs = [
        (lambda p: sd_capsule(p, np.array([-0.95, 0.55, 0.2], np.float32), np.array([-0.95, 2.55, 0.2], np.float32), 0.55), {"color": LIME, "rough": 0.4}),
        (lambda p: sd_capsule(p, np.array([0.25, 0.45, -0.35], np.float32), np.array([0.45, 3.1, -0.35], np.float32), 0.45), {"color": BLUE, "rough": 0.15}),
        (lambda p: sd_capsule(p, np.array([1.25, 0.38, 0.45], np.float32), np.array([1.05, 1.7, 0.45], np.float32), 0.38), {"color": WHITE, "rough": 0.1}),
        (lambda p: sd_sphere(p, np.array([-0.15, 0.22, 1.0], np.float32), 0.22), {"color": CHROME, "rough": 0.05, "metal": 1.0}),
    ]
    mats = [{"color": np.array([0.05, 0.055, 0.055], np.float32), "rough": 0.3}] + [o[1] for o in objs]
    return Scene(objs), mats


def orbs_scene():
    objs = [
        (lambda p: sd_sphere(p, np.array([-1.3, 0.95, 0.4], np.float32), 0.95), {"color": LIME, "rough": 0.38}),
        (lambda p: sd_sphere(p, np.array([0.55, 0.7, -0.2], np.float32), 0.7), {"color": CHROME, "rough": 0.04, "metal": 1.0}),
        (lambda p: sd_sphere(p, np.array([1.85, 0.48, 0.7], np.float32), 0.48), {"color": BLUE, "rough": 0.14}),
        (lambda p: sd_sphere(p, np.array([-0.1, 0.28, 1.25], np.float32), 0.28), {"color": WHITE, "rough": 0.1}),
        (lambda p: sd_torus(p, np.array([2.9, 0.18, -1.2], np.float32), 0.5, 0.18, rot_x(0.0)), {"color": WHITE, "rough": 0.3}),
    ]
    mats = [{"color": np.array([0.05, 0.055, 0.055], np.float32), "rough": 0.22}] + [o[1] for o in objs]
    return Scene(objs), mats


def stills():
    sc, mats = torus_scene(0.6)
    save(render(sc, mats, 1200, 1500, cam=(0.0, 2.4, -6.2), look=(0, 1.35, 0), fov=0.62, ss=1.25, seed=2), "v2-torus")
    sc, mats = pills_scene()
    save(render(sc, mats, 900, 1600, cam=(0.2, 2.2, -6.0), look=(0.1, 1.55, 0), fov=0.62, ss=1.25, seed=3), "v2-pills")
    sc, mats = orbs_scene()
    save(render(sc, mats, 1600, 1067, cam=(0.2, 2.0, -6.4), look=(0.3, 0.6, 0.2), fov=0.5, ss=1.25, seed=4), "v2-orbs")


def video():
    frames = os.path.join(OUT, "_v2frames")
    os.makedirs(frames, exist_ok=True)
    fps, secs = 24, 5
    n = fps * secs
    for i in range(n):
        t = 2 * np.pi * i / n
        sc, mats = torus_scene(t)
        img = render(sc, mats, 960, 540, cam=(0.0, 2.2, -6.6), look=(0, 1.3, 0), fov=0.48, ss=1.0, seed=10 + i)
        Image.fromarray((img * 255).astype(np.uint8)).save(os.path.join(frames, f"{i:04d}.png"))
        if i % 12 == 0:
            print("frame", i, flush=True)
    sc, mats = torus_scene(0.0)
    save(render(sc, mats, 960, 540, cam=(0.0, 2.2, -6.6), look=(0, 1.3, 0), fov=0.48, ss=1.25, seed=99), "v2-loop-poster")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", os.path.join(frames, "%04d.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-preset", "slow", "-movflags", "+faststart", "-an", os.path.join(OUT, "v2-loop.mp4")],
        check=True,
    )
    for f in os.listdir(frames):
        os.remove(os.path.join(frames, f))
    os.rmdir(frames)
    print("video done")


if WHICH in ("still", "all"):
    stills()
if WHICH in ("video", "all"):
    video()
