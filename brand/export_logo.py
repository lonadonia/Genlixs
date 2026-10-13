import sys, os
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
src_dir, out_dir = sys.argv[1], sys.argv[2]
os.makedirs(out_dir, exist_ok=True)
pad = 40
for name, out in [('Logo-white.png', 'genlixs-logo-white'), ('logo-black.png', 'genlixs-logo-dark')]:
    im = Image.open(os.path.join(src_dir, name)).convert('RGBA')
    bbox = im.getchannel('A').point(lambda a: 255 if a > 12 else 0).getbbox()
    im = im.crop((bbox[0]-pad, bbox[1]-pad, bbox[2]+pad, bbox[3]+pad))
    print(name, 'trimmed', im.size, 'ratio', im.width/im.height)
    for w in (480, 960):
        h = round(im.height * w / im.width)
        r = im.resize((w, h), Image.LANCZOS)
        r.save(os.path.join(out_dir, f'{out}-{w}.png'), optimize=True)
        r.save(os.path.join(out_dir, f'{out}-{w}.webp'), quality=92, method=6)
        print(' ', w, h)
    if name == 'Logo-white.png':
        full = Image.open(os.path.join(src_dir, name)).convert('RGBA')
        # symbol occupies x 740..4630 at full scale (gap to wordmark at 4630..5200)
        sym = full.crop((700, 0, 4900, full.height))
        sb = sym.getchannel('A').point(lambda a: 255 if a > 12 else 0).getbbox()
        sym = sym.crop(sb)
        print('symbol', sym.size)
        side = max(sym.size)
        for size, fname, padding in [(512,'genlixs-symbol-512.png',0.08),(180,'apple-icon.png',0.16),(64,'genlixs-symbol-64.png',0.04)]:
            canvas_side = round(side * (1+2*padding))
            canvas = Image.new('RGBA', (canvas_side, canvas_side), (0,0,0,0))
            canvas.paste(sym, ((canvas_side-sym.width)//2, (canvas_side-sym.height)//2), sym)
            if fname == 'apple-icon.png':
                bg = Image.new('RGBA', canvas.size, (11,15,26,255))
                bg.alpha_composite(canvas)
                canvas = bg
            canvas.resize((size,size), Image.LANCZOS).save(os.path.join(out_dir, fname), optimize=True)
        canvas_side = round(side*1.04)
        canvas = Image.new('RGBA', (canvas_side, canvas_side), (0,0,0,0))
        canvas.paste(sym, ((canvas_side-sym.width)//2, (canvas_side-sym.height)//2), sym)
        canvas.resize((256,256), Image.LANCZOS).save(os.path.join(out_dir, 'favicon.ico'), sizes=[(16,16),(32,32),(48,48),(64,64)])
        # Open Graph image: supplied white logo on the dark canvas token
        og = Image.new('RGBA', (1200, 630), (11,15,26,255))
        lw = 640
        logo = im.resize((lw, round(im.height*lw/im.width)), Image.LANCZOS)
        og.alpha_composite(logo, ((1200-lw)//2, (630-logo.height)//2 - 20))
        bars = [(28,93,255),(173,219,90),(118,61,255),(254,85,17)]
        bw = 64
        x0 = (1200 - (bw*4 + 12*3))//2
        for i,c in enumerate(bars):
            x = x0 + i*(bw+12)
            og.paste(Image.new('RGBA',(bw,8),c+(255,)), (x, 430))
        og.convert('RGB').save(os.path.join(out_dir, 'opengraph-image.png'), optimize=True)
