"""Resize the cached Archive previews to small JPEGs served from our origin, and mark them in the pool.
Usage: python3 scripts/thumbs.py   (after scripts/fetch-archive.mjs)"""
import json, os, re, sys
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parent.parent
raw, out = root / 'scripts/.cache/thumbs', root / 'public/archive/thumbs'
out.mkdir(parents=True, exist_ok=True)
pool_path = root / 'src/data/archive-pool.json'
pool = json.loads(pool_path.read_text())
done = 0
for item in pool:
    safe = re.sub(r'[^\w.-]', '_', item['id'])
    src = raw / f'{safe}.img'
    item.pop('thumb', None)
    if not src.exists(): continue
    try:
        im = Image.open(src).convert('RGB')
    except Exception:
        continue
    if im.width < 48 or im.height < 48: continue
    im.thumbnail((320, 320))
    im.save(out / f'{safe}.jpg', quality=74, optimize=True)
    item['thumb'] = f'/archive/thumbs/{safe}.jpg'
    done += 1
pool_path.write_text(json.dumps(pool, separators=(',', ':')))
size = sum(f.stat().st_size for f in out.glob('*.jpg'))
print(f'{done} thumbnails, {size / 1024 / 1024:.1f} MB')
