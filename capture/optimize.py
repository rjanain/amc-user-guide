#!/usr/bin/env python3
"""Shrinks the guide's screenshots in place: 256 colours, no dithering.

Screenshots of the interface have few colours, so this looks the same and
saves about 60%. Needs Pillow. capture.mjs runs it after taking the
pictures; it can also be run by hand: python3 optimize.py [files...]
"""
import glob
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
files = sys.argv[1:] or sorted(glob.glob(os.path.join(HERE, '..', 'screenshots', '*.png')))
before = after = 0
for f in files:
    if os.path.basename(f).startswith('._'):
        continue
    im = Image.open(f)
    if im.mode == 'P':  # already done
        continue
    before += os.path.getsize(f)
    im.convert('RGB').quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(f, optimize=True)
    after += os.path.getsize(f)
if before:
    print(f'  screenshots: {before // 1024} KB -> {after // 1024} KB')
