#!/usr/bin/env python3
"""
Builds the game's sprite sheets from AI-generated pictures.

Each character is generated in two views (front: facing down-left; back:
facing up-right), a still plus a strip of animation frames per view. This
script cuts the strips into frames, brings every frame of a character to one
scale and one footing, mirrors the two views to get four directions, and
writes `public/sprites/<name>.webp` with a `<name>.json` that tells the game
which frames make up which animation in which direction.

Usage: python3 build.py <folder with the generated pictures> [name ...]
Expected files in the folder, per character:
  <name>-front.png, <name>-back.png                  stills (optional when animations exist)
  <name>-<anim>_<view>.png                           a row of square frames; anim is run / attack / death
A villager needs only <name>-front.png.
"""
import json
import sys
from pathlib import Path

from PIL import Image

FRAME = 192                      # size of one frame in the sheet
COLUMNS = 8
REPO = Path(__file__).resolve().parents[2]
OUT = REPO / 'public' / 'sprites'
# Directions as the game counts them: 0 looks down-right, 2 down-left, 4 up-left, 6 up-right.
VIEWS = {2: ('front', False), 0: ('front', True), 6: ('back', False), 4: ('back', True)}
ANIMATIONS = ['idle', 'run', 'attack', 'death']
ALPHA_FLOOR = 24                 # fainter pixels are leftovers of background removal


def clean(image: Image.Image) -> Image.Image:
    image = image.convert('RGBA')
    alpha = image.getchannel('A').point(lambda a: 0 if a < ALPHA_FLOOR else a)
    image.putalpha(alpha)
    return image


def strip_frames(path: Path) -> list[Image.Image]:
    strip = clean(Image.open(path))
    size = strip.height
    return [strip.crop((i * size, 0, (i + 1) * size, size)) for i in range(strip.width // size)]


def box_of(frames: list[Image.Image]):
    boxes = [frame.getbbox() for frame in frames if frame.getbbox()]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))


def build(folder: Path, name: str) -> None:
    # Every frame available, by view and animation.
    source: dict[str, dict[str, list[Image.Image]]] = {'front': {}, 'back': {}}
    for view in source:
        for animation in ('run', 'attack', 'death'):
            path = folder / f'{name}-{animation}_{view}.png'
            if path.exists():
                source[view][animation] = strip_frames(path)
        still = folder / f'{name}-{view}.png'
        if source[view].get('attack'):
            # The first frame of the attack is the ready stance, drawn at the same scale as the rest.
            source[view]['idle'] = [source[view]['attack'][0]]
        elif source[view].get('run'):
            source[view]['idle'] = [source[view]['run'][0]]
        elif still.exists():
            source[view]['idle'] = [clean(Image.open(still))]
    if not source['front']:
        raise SystemExit(f'{name}: no front view found in {folder}')

    # One scale for all the frames of a view, so the character does not grow or shrink between animations.
    placed: dict[str, dict[str, list[Image.Image]]] = {}

    def measure(view: str):
        frames = [f for animation in ('run', 'attack', 'idle') for f in source[view].get(animation, [])]
        return box_of(frames)

    for view, animations in source.items():
        if not animations:
            continue
        left, top, right, bottom = measure(view)
        # Each view is fitted to the frame by itself: a still and an animation strip are framed differently.
        scale = min(FRAME * 0.94 / (right - left), FRAME * 0.88 / (bottom - top))
        # The feet stand on one line; the figure is centred on its idle pose so it does not drift.
        idle_box = box_of(animations['idle'])
        centre_x = (idle_box[0] + idle_box[2]) / 2
        placed[view] = {}
        for animation, frames in animations.items():
            out = []
            for frame in frames:
                size = frame.width
                small = frame.resize((max(1, round(size * scale)),) * 2, Image.LANCZOS)
                cell = Image.new('RGBA', (FRAME, FRAME), (0, 0, 0, 0))
                x = round(FRAME / 2 - centre_x * scale)
                y = round(FRAME * ANCHOR_Y - bottom * scale)
                cell.alpha_composite(small, (x, y)) if 0 <= x and 0 <= y and x + small.width <= FRAME and y + small.height <= FRAME else cell.paste(small, (x, y), small)
                out.append(cell)
            placed[view][animation] = out

    cells: list[Image.Image] = []
    meta = {'frame': FRAME, 'scale': 0.5, 'anchor': {'x': 0.5, 'y': ANCHOR_Y}, 'directions': [], 'animations': {}}
    for animation in ANIMATIONS:
        for direction, (view, mirrored) in VIEWS.items():
            frames = placed.get(view, {}).get(animation)
            if not frames:
                continue
            start = len(cells)
            cells.extend(frame.transpose(Image.FLIP_LEFT_RIGHT) if mirrored else frame for frame in frames)
            meta['animations'].setdefault(animation, {})[str(direction)] = list(range(start, len(cells)))
            if direction not in meta['directions']:
                meta['directions'].append(direction)
    meta['directions'].sort()

    rows = -(-len(cells) // COLUMNS)
    sheet = Image.new('RGBA', (COLUMNS * FRAME, rows * FRAME), (0, 0, 0, 0))
    for index, cell in enumerate(cells):
        sheet.paste(cell, ((index % COLUMNS) * FRAME, (index // COLUMNS) * FRAME))
    OUT.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT / f'{name}.webp', 'WEBP', quality=88, method=6)
    (OUT / f'{name}.json').write_text(json.dumps(meta, separators=(',', ':')) + '\n')
    print(f'{name}: {len(cells)} frames, {(OUT / f"{name}.webp").stat().st_size // 1024} KB, animations {sorted(meta["animations"])}')


ANCHOR_Y = 0.9

if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    folder = Path(sys.argv[1])
    names = sys.argv[2:] or sorted({p.name.rsplit('-', 1)[0] for p in folder.glob('*-front.png')})
    for name in names:
        build(folder, name)
