"""Procedural concept media for the Genlixs design preview.

Every file produced here is TEMPORARY concept media (design guide §14):
it is original procedural artwork, not model output, and must be replaced
by validated Genlixs generations before launch.
"""
import os
import sys
import subprocess
import numpy as np
from PIL import Image, ImageFilter

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)


def hexc(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255.0


def mix(a, b, t):
    t = np.clip(t, 0, 1)[..., None] if np.ndim(t) else np.clip(t, 0, 1)
    return a * (1 - t) + b * t


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def value_noise_2d(w, h, cells, seed):
    r = np.random.default_rng(seed)
    g = (r.random((cells[1] + 1, cells[0] + 1)) * 255).astype(np.uint8)
    img = Image.fromarray(g, 'L').resize((w, h), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32) / 255.0


def fbm_2d(w, h, base, octaves, seed):
    acc = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        c = (max(1, base[0] * 2 ** o), max(1, base[1] * 2 ** o))
        acc += amp * value_noise_2d(w, h, c, seed + o)
        tot += amp
        amp *= 0.5
    return acc / tot


def fbm_1d(n, base, octaves, seed):
    r = np.random.default_rng(seed)
    x = np.linspace(0, 1, n)
    acc = np.zeros(n)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        k = base * 2 ** o
        pts = r.random(k + 2)
        xs = np.linspace(0, 1, k + 2)
        acc += amp * np.interp(x, xs, pts)
        tot += amp
        amp *= 0.5
    v = acc / tot
    # soften the piecewise-linear joints
    kern = np.hanning(max(3, n // 120))
    kern /= kern.sum()
    return np.convolve(np.pad(v, len(kern), mode='edge'), kern, mode='same')[len(kern):-len(kern)]


def grain(img, amount, seed):
    r = np.random.default_rng(seed)
    n = r.normal(0, amount, img.shape[:2]).astype(np.float32)[..., None]
    return img + n


def vignette(img, strength):
    h, w = img.shape[:2]
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt(((x - w / 2) / (w / 2)) ** 2 + ((y - h / 2) / (h / 2)) ** 2)
    return img * (1 - strength * smooth((d - 0.55) / 0.9))[..., None]


def save(img, name, quality=86):
    arr = (np.clip(img, 0, 1) * 255).astype(np.uint8)
    im = Image.fromarray(arr, 'RGB')
    im.save(os.path.join(OUT, name + '.jpg'), quality=quality, optimize=True, progressive=True)
    return im


# --------------------------------------------------------------- dunes
def dunes(w, h, mode, seed=11):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    v = y / h
    if mode == 'dusk':
        sky = mix(hexc('#1b1642'), hexc('#7a2f6e'), smooth(v / 0.45))
        sky = mix(sky, hexc('#ff8a3d'), smooth((v - 0.35) / 0.25))
        sun = (0.64, 0.50, 0.050)
        sun_col, glow_col = hexc('#ffe2b0'), hexc('#ff9a52')
        far, near = hexc('#b4566a'), hexc('#2a1226')
        lit, rim = hexc('#ff9a5c'), hexc('#ffc58a')
        haze_col = hexc('#ff8a4a')
    else:
        sky = mix(hexc('#2a63c9'), hexc('#8fbdf0'), smooth(v / 0.5))
        sky = mix(sky, hexc('#e6f0f8'), smooth((v - 0.38) / 0.2))
        sun = (0.30, 0.16, 0.035)
        sun_col, glow_col = hexc('#ffffff'), hexc('#fff3d6')
        far, near = hexc('#e8c79c'), hexc('#b9773f')
        lit, rim = hexc('#f6dcb2'), hexc('#fff0d8')
        haze_col = hexc('#e9eef2')
    img = sky.copy()
    sx, sy, sr = sun[0] * w, sun[1] * h, sun[2] * w
    d = np.sqrt((x - sx) ** 2 + (y - sy) ** 2)
    img = mix(img, glow_col, 0.75 * np.exp(-(d / (sr * 7)) ** 1.4))
    img = mix(img, sun_col, smooth((sr - d) / 2.5))
    # thin clouds
    cl = fbm_2d(w, h, (2, 9), 5, seed + 40)
    band = np.exp(-((v - (0.22 if mode == 'dusk' else 0.25)) / 0.08) ** 2)
    cloud_col = hexc('#ffb07a') if mode == 'dusk' else hexc('#ffffff')
    img = mix(img, cloud_col, smooth((cl - 0.55) / 0.18) * band * 0.35)

    layers = 6
    for i in range(layers):
        t = i / (layers - 1)
        base = 0.50 + 0.085 * i + 0.02 * t * t
        ridge = fbm_1d(w, 3 + i, 4, seed + i * 3)
        ridge = (base - 0.06 * (1 - 0.4 * t) * (ridge - 0.5) * 2
                 - 0.035 * np.sin(np.linspace(0, (2 + i) * np.pi, w) + i * 1.7))
        ridge_px = ridge * h
        col = mix(far, near, t ** 0.9)
        slope = np.gradient(ridge_px)
        k = np.hanning(61); k /= k.sum()
        slope = np.convolve(np.pad(slope, 61, mode='edge'), k, mode='same')[61:-61]
        facing = np.clip(-slope * (1 if sun[0] > 0.5 else -1) * 0.9 + 0.5, 0, 1)
        mask = smooth((y - ridge_px[None, :]) / 1.6)
        depth = np.clip((y - ridge_px[None, :]) / (h * 0.10), 0, 1)
        shade = mix(col, lit, (facing[None, :] * (1 - depth) * (0.55 - 0.25 * t)))
        shade = mix(shade, rim, np.exp(-(y - ridge_px[None, :]).clip(0) / 3.0) * (0.55 if mode == 'dusk' else 0.35) * facing[None, :])
        if i >= 3:
            rip = np.sin((y * 0.22 + 18 * fbm_2d(w, h, (6, 4), 3, seed + 90 + i)) * (1.2 + 0.4 * t))
            shade = shade * (1 + 0.035 * rip[..., None])
        shade = mix(shade, haze_col, (1 - t) * 0.35)
        img = img * (1 - mask[..., None]) + shade * mask[..., None]
    img = vignette(img, 0.35 if mode == 'dusk' else 0.18)
    img = grain(img, 0.012, seed)
    return img


# --------------------------------------------------------------- aurora
def aurora(w, h, t=0.0, seed=21, stars_seed=3):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = x / w, y / h
    horizon = 0.68
    sky = mix(hexc('#050916'), hexc('#0d2236'), smooth(v / horizon))
    sky = mix(sky, hexc('#183a45'), smooth((v - 0.5) / (horizon - 0.5)) * 0.8)
    r = np.random.default_rng(stars_seed)
    n = int(w * h * 0.0012)
    sxs, sys_ = r.integers(0, w, n), r.integers(0, int(h * horizon), n)
    br = r.random(n) ** 3
    tw = 0.75 + 0.25 * np.sin(t * 5 + r.random(n) * 6.28)
    star = np.zeros((h, w), np.float32)
    star[sys_, sxs] = br * tw
    star = np.asarray(Image.fromarray((np.clip(star, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), np.float32) / 255 * 2.2
    img = sky + star[..., None] * hexc('#e8f0ff')

    total = np.zeros((h, w), np.float32)
    hue = np.zeros((h, w), np.float32)
    rays_noise = fbm_1d(w * 2, 60, 3, seed + 9)
    for k, (base, amp, freq, spd, width) in enumerate([
        (0.42, 0.035, 0.55, 0.35, 0.05),
        (0.50, 0.025, 0.9, -0.25, 0.04),
        (0.33, 0.02, 1.3, 0.18, 0.035),
    ]):
        wav = fbm_1d(w, 4, 3, seed + k)
        yc = base + amp * np.sin(u[0] * freq * 6.283 + t * spd + k) + 0.09 * (wav - 0.5) + 0.01 * np.sin(u[0] * 9 + t * 0.8 + k)
        dy = v - yc[None, :]
        below = np.exp(-(np.clip(dy, 0, None) / (width * 0.35)) ** 2)
        above = np.exp(-(np.clip(-dy, 0, None) / (width * 3.2)))
        curtain = np.where(dy > 0, below, above)
        off = int((t * 40 * (k + 1)) % w)
        rays = rays_noise[off:off + w] if off + w <= len(rays_noise) else np.roll(rays_noise, -off)[:w]
        rays = 0.45 + 0.9 * (rays - rays.min()) / (np.ptp(rays) + 1e-6)
        inten = curtain * rays[None, :] * (0.9 - 0.2 * k)
        total += inten
        hue += inten * np.clip(-dy / (width * 3.2), 0, 1)
    hue = np.clip(hue / (total + 1e-4), 0, 1)
    acol = mix(hexc('#9cf27a'), hexc('#8a5cff'), smooth(hue * 1.4))
    sky_mask = (v < horizon)[..., None]
    img = img + (acol * np.clip(total, 0, 1.6)[..., None] * 0.85) * sky_mask
    # mountains
    ridge = horizon - 0.02 - 0.16 * fbm_1d(w, 5, 5, seed + 50) ** 1.6
    ridge2 = horizon - 0.01 - 0.07 * fbm_1d(w, 9, 4, seed + 60)
    m1 = smooth((v - ridge[None, :]) * h / 1.5)
    m2 = smooth((v - ridge2[None, :]) * h / 1.5)
    img = mix(img, hexc('#0a1420'), m1 * (v < horizon))
    img = mix(img, hexc('#060c14'), m2 * (v < horizon))
    # lake reflection
    ry = (2 * horizon - v)
    ripple = 0.004 * np.sin(v * 900 + t * 3) * (v - horizon) * 8
    src_y = np.clip(((ry + ripple) * h).astype(int), 0, h - 1)
    src_x = np.clip(x.astype(int), 0, w - 1)
    refl = img[src_y, src_x] * 0.55
    lake = v >= horizon
    img = np.where(lake[..., None], refl * mix(np.ones(3, np.float32), hexc('#6a8aa8'), 0.3), img)
    img = vignette(img, 0.4)
    return grain(img, 0.01, seed + int(t * 100))


# --------------------------------------------------------------- spheres
def spheres(w, h, ss=1.5):
    W, H = int(w * ss), int(h * ss)
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    aspect = W / H
    px = (x / W * 2 - 1) * aspect * 0.62
    py = -(y / H * 2 - 1) * 0.62
    ro = np.array([0.0, 1.35, -5.2], np.float32)
    fwd = np.array([0, -0.16, 1], np.float32)
    fwd /= np.linalg.norm(fwd)
    right = np.cross(np.array([0, 1, 0], np.float32), fwd)
    right /= np.linalg.norm(right)
    up = np.cross(fwd, right)
    rd = fwd[None, None, :] + px[..., None] * right + py[..., None] * up
    rd /= np.linalg.norm(rd, axis=-1, keepdims=True)
    S = [  # center, radius, albedo, gloss
        (np.array([-1.25, 0.95, 0.9]), 0.95, hexc('#ff6a2b'), 0.25),
        (np.array([0.75, 0.62, 0.15]), 0.62, hexc('#d9dee8'), 0.9),
        (np.array([1.95, 0.42, 1.2]), 0.42, hexc('#b6e06a'), 0.2),
        (np.array([-0.05, 0.30, -0.95]), 0.30, hexc('#7b4bff'), 0.55),
    ]
    light = np.array([-3.0, 5.5, -2.5], np.float32)

    def trace(o, d):
        tmin = np.full(d.shape[:-1], np.inf, np.float32)
        idx = np.full(d.shape[:-1], -1, np.int8)
        for i, (c, r, _, _) in enumerate(S):
            oc = o - c
            b = np.sum(oc * d, -1)
            cc = np.sum(oc * oc, -1) - r * r
            disc = b * b - cc
            tt = -b - np.sqrt(np.clip(disc, 0, None))
            hit = (disc > 0) & (tt > 1e-3) & (tt < tmin)
            tmin = np.where(hit, tt, tmin)
            idx = np.where(hit, i, idx)
        tp = np.where(d[..., 1] < -1e-4, -o[..., 1] / np.where(d[..., 1] == 0, 1, d[..., 1]), np.inf) if o.ndim > 1 else -o[1] / np.where(d[..., 1] == 0, 1, d[..., 1])
        tp = np.where((tp > 1e-3) & (d[..., 1] < 0), tp, np.inf)
        hitp = tp < tmin
        tmin = np.where(hitp, tp, tmin)
        idx = np.where(hitp, 9, idx)
        return tmin, idx

    def shadow(p):
        acc = np.zeros(p.shape[:-1], np.float32)
        r = np.random.default_rng(1)
        samples = 10
        for s in range(samples):
            lp = light + (r.random(3) - 0.5) * np.array([2.2, 0.4, 2.2])
            ld = lp - p
            ld /= np.linalg.norm(ld, axis=-1, keepdims=True)
            vis = np.ones(p.shape[:-1], np.float32)
            for (c, rad, _, _) in S:
                oc = p - c
                b = np.sum(oc * ld, -1)
                cc = np.sum(oc * oc, -1) - rad * rad
                disc = b * b - cc
                tt = -b - np.sqrt(np.clip(disc, 0, None))
                vis = np.where((disc > 0) & (tt > 1e-3), 0, vis)
            acc += vis
        return acc / samples

    def background(d):
        t = np.clip(d[..., 1] * 1.6 + 0.35, 0, 1)
        return mix(hexc('#efe9e2'), hexc('#c9d3e6'), t)

    def shade(o, d, depth):
        t, idx = trace(o, d)
        col = background(d)
        p = o + d * np.where(np.isinf(t), 0, t)[..., None]
        ld = light - p
        ld /= np.linalg.norm(ld, axis=-1, keepdims=True) + 1e-6
        sh = shadow(p)
        # floor
        fm = idx == 9
        if fm.any():
            n = np.zeros_like(p)
            n[..., 1] = 1
            diff = np.clip(np.sum(n * ld, -1), 0, 1)
            checker = 0.96 + 0.04 * ((np.floor(p[..., 0] * 1.2) + np.floor(p[..., 2] * 1.2)) % 2)
            ao = np.ones_like(diff)
            for (c, r, _, _) in S:
                dd = np.sqrt((p[..., 0] - c[0]) ** 2 + (p[..., 2] - c[2]) ** 2)
                ao *= 1 - 0.55 * np.exp(-((dd / (r * 1.25)) ** 2))
            fc = hexc('#e6ded5') * (0.35 + 0.65 * diff * (0.25 + 0.75 * sh))[..., None] * ao[..., None] * checker[..., None]
            fog = 1 - np.exp(-np.where(fm, t, 0) * 0.07)
            fc = mix(fc, background(d), fog)
            col = np.where(fm[..., None], fc, col)
        for i, (c, r, alb, gloss) in enumerate(S):
            m = idx == i
            if not m.any():
                continue
            n = (p - c) / r
            diff = np.clip(np.sum(n * ld, -1), 0, 1)
            hv = ld - d
            hv /= np.linalg.norm(hv, axis=-1, keepdims=True) + 1e-6
            spec = np.clip(np.sum(n * hv, -1), 0, 1) ** (20 + gloss * 160) * (0.2 + gloss)
            fres = (1 - np.clip(-np.sum(n * d, -1), 0, 1)) ** 3
            base = alb * (0.22 + 0.78 * (diff * (0.3 + 0.7 * sh)))[..., None]
            sc = base + spec[..., None] * sh[..., None]
            if depth > 0 and gloss > 0.5:
                rd2 = d - 2 * np.sum(d * n, -1, keepdims=True) * n
                refl = shade(p + n * 1e-3, rd2, depth - 1)
                sc = mix(sc, refl, (gloss * 0.55 + 0.4 * fres) * np.ones_like(fres))
            else:
                sc = sc + fres[..., None] * 0.18
            col = np.where(m[..., None], sc, col)
        return col

    img = shade(np.broadcast_to(ro, rd.shape).copy(), rd, 1)
    img = np.clip(img, 0, 1) ** (1 / 1.05)
    im = Image.fromarray((img * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)
    out = np.asarray(im, np.float32) / 255
    return grain(vignette(out, 0.15), 0.008, 3)


# --------------------------------------------------------------- product
def product(w, h):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = x / w, y / h
    bg = mix(hexc('#efe7dd'), hexc('#d8c6b3'), smooth(v))
    d = np.sqrt((u - 0.5) ** 2 * 1.4 + (v - 0.38) ** 2)
    bg = mix(bg, hexc('#fbf6ef'), np.exp(-(d / 0.32) ** 2) * 0.8)
    img = bg
    # pedestal (cylinder)
    cx, top, bot, rw = 0.5, 0.66, 1.05, 0.30
    ell = 0.045
    inside_x = np.abs(u - cx) < rw
    xn = np.clip((u - cx) / rw, -1, 1)
    top_y = top + ell * np.sqrt(np.clip(1 - xn ** 2, 0, 1))
    side = inside_x & (v > top_y)
    lam = np.clip(np.cos((xn + 0.35) * 1.3), 0, 1)
    side_col = mix(hexc('#b8a28c'), hexc('#f4ece2'), lam)
    img = np.where(side[..., None], side_col, img)
    topm = ((u - cx) / rw) ** 2 + ((v - top) / ell) ** 2 <= 1
    top_col = mix(hexc('#efe4d8'), hexc('#fffaf3'), smooth(1 - ((v - (top - ell)) / (2 * ell))))
    img = np.where(topm[..., None], top_col, img)
    # contact shadow on pedestal
    sh = np.exp(-(((u - cx) / 0.13) ** 2 + ((v - (top + 0.005)) / 0.018) ** 2))
    img = img * (1 - 0.45 * sh * topm)[..., None]
    # floor shadow of pedestal
    fs = np.exp(-(((u - cx - 0.08) / 0.42) ** 2)) * smooth((v - 0.97) / 0.03)
    img = img * (1 - 0.15 * fs)[..., None]
    # bottle
    bw, bt, bb = 0.105, 0.30, 0.665
    bx = np.abs(u - cx)
    corner = 0.035
    body = (bx < bw) & (v > bt) & (v < bb)
    rr = (bx > bw - corner) & (v < bt + corner)
    body &= ~(rr & (((bx - (bw - corner)) ** 2 + (v - (bt + corner)) ** 2) > corner ** 2))
    xn2 = (u - cx) / bw
    glass = mix(hexc('#7a3b12'), hexc('#d7782c'), np.clip(np.cos(xn2 * 1.4 + 0.25), 0, 1))
    glass = mix(glass, hexc('#3d1906'), smooth((np.abs(xn2) - 0.7) / 0.3) * 0.8)
    hl = np.exp(-((xn2 + 0.55) / 0.07) ** 2) * 0.75 + np.exp(-((xn2 - 0.62) / 0.04) ** 2) * 0.35
    glass = mix(glass, hexc('#fff3e0'), hl)
    glass = mix(glass, hexc('#4a1f08'), smooth((v - (bb - 0.05)) / 0.05) * 0.5)
    img = np.where(body[..., None], glass, img)
    # label
    lab = (bx < bw * 0.78) & (v > 0.43) & (v < 0.57)
    lab_col = mix(hexc('#cfc6ba'), hexc('#f7f2ea'), np.clip(np.cos(xn2 * 1.2 + 0.2), 0, 1))
    img = np.where(lab[..., None], lab_col, img)
    line = lab & (np.abs(v - 0.475) < 0.004) & (bx < bw * 0.5)
    img = np.where(line[..., None], hexc('#3b2a1e'), img)
    line2 = lab & (np.abs(v - 0.51) < 0.002) & (bx < bw * 0.35)
    img = np.where(line2[..., None], hexc('#8a7a6a'), img)
    # neck + cap
    neck = (bx < 0.032) & (v > 0.255) & (v <= bt + 0.01)
    img = np.where(neck[..., None], mix(hexc('#5a2a0c'), hexc('#c46a26'), np.clip(np.cos((u - cx) / 0.032 * 1.3), 0, 1)), img)
    cap = (bx < 0.05) & (v > 0.165) & (v <= 0.258)
    capc = mix(hexc('#141414'), hexc('#5a5a5a'), np.clip(np.cos((u - cx) / 0.05 * 1.4 + 0.4), 0, 1))
    img = np.where(cap[..., None], capc, img)
    # bottle cast shadow on wall
    ws = np.exp(-(((u - cx - 0.2) / 0.12) ** 2 + ((v - 0.5) / 0.2) ** 2)) * (~body) * (v < top)
    img = img * (1 - 0.12 * ws)[..., None]
    img = vignette(img, 0.2)
    return grain(img, 0.009, 5)


def main():
    save(dunes(1600, 1067, 'dusk'), 'dunes-dusk')
    save(dunes(1600, 1067, 'noon'), 'dunes-noon')
    save(spheres(1600, 1067), 'studio-spheres')
    save(product(1200, 1200), 'product-amber')
    save(aurora(900, 1600, 0.0), 'aurora-vertical')
    video()


def video():
    poster = aurora(1280, 720, 0.0, seed=33)
    save(poster, 'aurora-clip-poster')
    frames = os.path.join(OUT, '_frames')
    os.makedirs(frames, exist_ok=True)
    fps, secs = 24, 6
    for i in range(fps * secs):
        f = aurora(1280, 720, i / fps, seed=33)
        Image.fromarray((np.clip(f, 0, 1) * 255).astype(np.uint8)).save(os.path.join(frames, f'{i:04d}.png'))
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(fps), '-i', os.path.join(frames, '%04d.png'),
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '27', '-preset', 'slow', '-movflags', '+faststart',
                    '-an', os.path.join(OUT, 'aurora-clip.mp4')], check=True)
    for f in os.listdir(frames):
        os.remove(os.path.join(frames, f))
    os.rmdir(frames)


if __name__ == '__main__':
    which = sys.argv[2] if len(sys.argv) > 2 else 'all'
    if which == 'all':
        main()
    else:
        fn = {'dusk': lambda: save(dunes(1600, 1067, 'dusk'), 'dunes-dusk'),
              'noon': lambda: save(dunes(1600, 1067, 'noon'), 'dunes-noon'),
              'spheres': lambda: save(spheres(1600, 1067), 'studio-spheres'),
              'product': lambda: save(product(1200, 1200), 'product-amber'),
              'aurora': lambda: save(aurora(900, 1600, 0.0), 'aurora-vertical'),
              'video': video}[which]
        fn()
