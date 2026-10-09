"""
Builds the HUD media for the simulated Overmind's item pool, the way the reference shipped its project media:
a 16:9 still per item (960x540 JPEG) and, where the Archive has moving pictures, a short muted loop (640x360 H.264).

  films     an 8 s slice of the Archive's MP4 (ffmpeg range-seeks, so only that slice is downloaded)
  software  the Archive's emulator capture (animated GIF) as a loop, and its first frame as the still
  texts     the scanned cover (BookReader cover image), cropped to 16:9 from the top
  audio     the largest cover image in the item, if any
Items without pictures (arXiv papers, items with no images) get the reference's typographic card at runtime.
Wayback pages are screenshotted separately by scripts/wayback-shots.mjs.

The Archive's data nodes send no CORS header, so the HUD (which reads pixels for its ASCII and pixel fills) needs
these copies on our own origin. Gentle: one item at a time, a pause between requests, results cached.

Usage: python3 scripts/fetch-media.py [--limit N]     (needs ffmpeg and Pillow)
"""
import io, json, re, subprocess, sys, time, urllib.request
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
out = root / 'public/archive/media'
out.mkdir(parents=True, exist_ok=True)
cache = root / 'scripts/.cache/media'
cache.mkdir(parents=True, exist_ok=True)
pool_path = root / 'src/data/archive-pool.json'
pool = json.loads(pool_path.read_text())
UA = {'User-Agent': 'OvermindArchivist/0.1 (research prototype; gentle crawler)'}
LIMIT = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
MAX_CLIPS = {'film': 45, 'software': 70}
W, H = 960, 540

def get(url, max_bytes=8_000_000):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        data = r.read(max_bytes + 1)
    if len(data) > max_bytes: raise ValueError('too large')
    return data

def still(img: Image.Image, dst: Path, anchor_y=0.5, pixel_art=False):
    img = img.convert('RGB')
    s = max(W / img.width, H / img.height)
    w, h = round(img.width * s), round(img.height * s)
    img = img.resize((w, h), Image.NEAREST if pixel_art else Image.LANCZOS)
    x0, y0 = (w - W) // 2, round((h - H) * anchor_y)
    img.crop((x0, y0, x0 + W, y0 + H)).save(dst, quality=74, optimize=True)

def ffmpeg(args):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', *args], capture_output=True, timeout=180)
    if r.returncode: raise RuntimeError(r.stderr.decode()[-300:])

VF = "scale=640:360:force_original_aspect_ratio=increase{flags},crop=640:360,fps=24,format=yuv420p"
def clip_from(src: str, dst: Path, start: float, seconds=8, pixel_art=False):
    flags = ':flags=neighbor' if pixel_art else ''
    ffmpeg(['-ss', f'{start:.2f}', '-t', str(seconds), '-i', src, '-an', '-vf', VF.format(flags=flags),
            '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-movflags', '+faststart', str(dst)])
    # a "capture" that is really a single frame is not worth a video element: keep the still only
    d = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(dst)], capture_output=True, text=True).stdout.strip()
    if not d or float(d) < 2: dst.unlink(missing_ok=True); return False
    return True

clips = {'film': 0, 'software': 0}
done = skipped = 0
for n, item in enumerate(pool):
    if LIMIT and n >= LIMIT: break
    if item['source'] != 'archive': continue
    safe = re.sub(r'[^\w.-]', '_', item['id'])
    jpg, mp4 = out / f'{safe}.jpg', out / f'{safe}.mp4'
    if jpg.exists():
        item['media'] = f'/archive/media/{safe}.jpg'
        if mp4.exists(): item['clip'] = f'/archive/media/{safe}.mp4'; clips[item['kind']] = clips.get(item['kind'], 0) + 1
        continue
    meta_path = cache / f'{safe}.json'
    try:
        if meta_path.exists(): meta = json.loads(meta_path.read_text())
        else:
            meta = json.loads(get(f'https://archive.org/metadata/{item["id"]}', 4_000_000)); meta_path.write_text(json.dumps(meta)); time.sleep(0.8)
        files = meta.get('files', [])
        base = f'https://archive.org/download/{item["id"]}/'
        kind = item['kind']
        if kind == 'film':
            mp4s = sorted([f for f in files if f.get('format') in ('h.264', '512Kb MPEG4', 'MPEG4', 'h.264 IA')], key=lambda f: int(f.get('size') or 1e12))
            if mp4s:
                f = mp4s[0]; length = float(f.get('length') or 120)
                start = max(5.0, min(length * 0.3, length - 12))
                if clips['film'] < MAX_CLIPS['film']:
                    if clip_from(base + urllib.request.quote(f['name']), mp4, start): clips['film'] += 1
                    ffmpeg(['-ss', f'{start + 2:.2f}', '-i', base + urllib.request.quote(f['name']), '-frames:v', '1', str(cache / f'{safe}.png')])
                    still(Image.open(cache / f'{safe}.png'), jpg)
                else:
                    ffmpeg(['-ss', f'{start:.2f}', '-i', base + urllib.request.quote(f['name']), '-frames:v', '1', str(cache / f'{safe}.png')])
                    still(Image.open(cache / f'{safe}.png'), jpg)
                time.sleep(1.0)
        elif kind == 'software':
            gif = next((f for f in files if f.get('format') == 'Emulator Screenshot' or f['name'].endswith('_screenshot.gif')), None)
            shot = next((f for f in files if re.match(r'(screenshot_00|00_coverscreenshot)\.(jpg|png)$', f['name'])), None)
            if gif and int(gif.get('size') or 0) < 6_000_000 and clips['software'] < MAX_CLIPS['software']:
                src = cache / f'{safe}.gif'
                src.write_bytes(get(base + urllib.request.quote(gif['name']))); time.sleep(0.8)
                if clip_from(str(src), mp4, 0, seconds=8, pixel_art=True): clips['software'] += 1
                still(Image.open(src), jpg, anchor_y=0.35, pixel_art=True)
            elif shot:
                still(Image.open(io.BytesIO(get(base + urllib.request.quote(shot['name'])))), jpg, pixel_art=True); time.sleep(0.8)
        elif kind in ('magazine', 'manual', 'newsletter', 'text'):
            still(Image.open(io.BytesIO(get(base + 'page/cover_w800.jpg'))), jpg, anchor_y=0.22); time.sleep(0.8)
        else:  # audio and anything else: the largest image file in the item
            imgs = sorted([f for f in files if f['name'].lower().endswith(('.jpg', '.jpeg', '.png')) and 'thumb' not in f['name'].lower()], key=lambda f: -int(f.get('size') or 0))
            if imgs and int(imgs[0].get('size') or 0) < 8_000_000:
                still(Image.open(io.BytesIO(get(base + urllib.request.quote(imgs[0]['name'])))), jpg); time.sleep(0.8)
    except Exception as e:
        print('skip', item['id'], str(e)[:120], flush=True); skipped += 1
        continue
    if jpg.exists():
        item['media'] = f'/archive/media/{safe}.jpg'; done += 1
        if mp4.exists(): item['clip'] = f'/archive/media/{safe}.mp4'
    if n % 25 == 0:
        pool_path.write_text(json.dumps(pool, separators=(',', ':')))
        print(n, 'items', done, 'new stills', clips, flush=True)

pool_path.write_text(json.dumps(pool, separators=(',', ':')))
size = sum(f.stat().st_size for f in out.iterdir()) / 1024 / 1024
print(f'done: {sum(1 for p in pool if p.get("media"))} stills, {sum(1 for p in pool if p.get("clip"))} clips, {skipped} skipped, {size:.1f} MB')
