"""Tiles every PNG in a folder into a 2-column contact sheet: python contact-sheet.py <dir> <out.jpg>"""
import glob, sys
from PIL import Image
d, out = sys.argv[1], sys.argv[2]
fs = sorted(glob.glob(f'{d}/*.png'))
ims = [Image.open(f).convert('RGB').resize((720, 450)) for f in fs]
sheet = Image.new('RGB', (1440, 450 * ((len(ims) + 1) // 2)))
for i, im in enumerate(ims): sheet.paste(im, ((i % 2) * 720, (i // 2) * 450))
sheet.save(out, quality=88)
print(len(fs), 'frames →', out)
