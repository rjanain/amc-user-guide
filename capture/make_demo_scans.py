#!/usr/bin/env python3
"""Scans of a pretend class, for the user guide's screenshots.

Like tests-ui/make_scans.py, but the answers look like a real class's:
each student has an ability, gets questions right or wrong accordingly,
writes a name in the name field and a student number in the code boxes.
A few things need the teacher, as with real scans: faint marks AMC is
unsure about, a blank page from a duplex scanner, one page scanned late,
two boxes ticked on a single-answer question, a mistyped student number.

Run inside the app's container (it has pdftoppm and Pillow):
  /venv/bin/python - "<exam folder>" /tmp/out '<options JSON>' < make_demo_scans.py

Writes <out>/scans-<class>.pdf (every page but the late one) and
<out>/late-page.pdf, and prints a JSON summary.
"""
import json
import os
import random
import sqlite3
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

DPI = 150
FONT = "/usr/share/texmf-dist/fonts/type1/urw/zapfchan/uzcmi8a.pfb"  # URW Chancery: looks handwritten


def mark(draw, box, scale, share, rng):
    """A pen mark filling `share` of the box, a little off-centre."""
    xmin, xmax, ymin, ymax = box
    sx, sy = scale
    w, h = (xmax - xmin) * sx, (ymax - ymin) * sy
    cx = (xmin + xmax) / 2 * sx + rng.uniform(-0.06, 0.06) * w
    cy = (ymin + ymax) / 2 * sy + rng.uniform(-0.06, 0.06) * h
    rx, ry = w * share ** 0.5 / 2 * 1.13, h * share ** 0.5 / 2 * 1.13  # an ellipse of the same area
    draw.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=rng.randint(15, 45))


def main():
    pdir, out = sys.argv[1], sys.argv[2]
    o = {"copies": 12, "code_base": 1000, "code_override": {}, "names": {}, "abilities": [],
         "faint": [], "blank_after": None, "late": None, "double": {}, "seed": 7, "class": "class"}
    if len(sys.argv) > 3:
        o.update(json.loads(sys.argv[3]))
    rng = random.Random(o["seed"])
    os.makedirs(out, exist_ok=True)
    tmp = os.path.join(out, "_render")
    os.makedirs(tmp, exist_ok=True)
    subprocess.run(["pdftoppm", "-r", str(DPI), "-gray", "-png",
                    os.path.join(pdir, "DOC-sujet.pdf"), os.path.join(tmp, "p")], check=True)
    rendered = sorted(f for f in os.listdir(tmp) if f.endswith(".png"))

    lay = sqlite3.connect(os.path.join(pdir, "data", "layout.sqlite"))
    sco = sqlite3.connect(os.path.join(pdir, "data", "scoring.sqlite"))
    names = dict(lay.execute("SELECT question, name FROM layout_question").fetchall())
    qtype = {(s, q): t for s, q, t in sco.execute("SELECT student, question, type FROM scoring_question")}
    correct = {}
    for s, q, a, c in sco.execute("SELECT student, question, answer, correct FROM scoring_answer"):
        correct.setdefault((s, q), {})[a] = bool(c)
    code_q = {q: n for q, n in names.items() if n and n.startswith("student[")}  # student[1] is the last digit
    font = ImageFont.truetype(FONT, 46)

    abilities = o["abilities"] or [0.5] * o["copies"]
    pages = lay.execute("SELECT student, page, subjectpage, width, height FROM layout_page "
                        "WHERE student <= ? ORDER BY student, page", (o["copies"],)).fetchall()
    images, late, summary = [], None, {"answers": {}, "codes": {}}
    for student, page, subjectpage, width, height in pages:
        p = abilities[(student - 1) % len(abilities)]
        img = Image.open(os.path.join(tmp, rendered[subjectpage - 1])).convert("L")
        scale = (img.width / width, img.height / height)
        draw = ImageDraw.Draw(img)
        boxes = {}
        for q, a, char, *coords in lay.execute(
                "SELECT question, answer, char, xmin, xmax, ymin, ymax FROM layout_box "
                "WHERE role=1 AND student=? AND page=? ORDER BY question, answer", (student, page)):
            boxes.setdefault(q, []).append((a, char, coords))
        # The student number, digit by digit (AMC numbers digits from the right).
        code = str(o["code_override"].get(str(student), o["code_base"] + student))
        for q, answers in boxes.items():
            if q in code_q:
                pos = int(code_q[q][len("student["):-1])
                digit = code.zfill(sum(1 for n in code_q.values()))[-pos]
                box = next((co for a, ch, co in answers if str(ch) == digit), None)
                if box:
                    mark(draw, box, scale, 0.55, rng)
                summary["codes"][student] = code
        # The name, in the name field.
        zone = lay.execute("SELECT xmin, xmax, ymin, ymax FROM layout_zone WHERE student=? AND page=? AND zone='__n'",
                           (student, page)).fetchone()
        name = o["names"].get(str(student))
        if zone and name:
            xmin, xmax, ymin, ymax = zone
            draw.text((xmin * scale[0] + 0.07 * (xmax - xmin) * scale[0], (ymin + 0.38 * (ymax - ymin)) * scale[1]),
                      name, font=font, fill=35)
        # The answers.
        first = True
        for q, answers in sorted(boxes.items()):
            if q in code_q:
                continue
            key = correct.get((student, q), {})
            ids = [a for a, _, _ in answers]
            right = [a for a in ids if key.get(a)]
            wrong = [a for a in ids if a in key and not key.get(a)]
            if qtype.get((student, q)) == 2:  # multiple answers: each box on its own; never "none of these"
                last = 0  # AMC numbers the "none of these" box (completemulti) 0
                ticks = [a for a in right if rng.random() < min(0.97, p + 0.08)]
                ticks += [a for a in wrong if a != last and rng.random() < (1 - p) * 0.45]
                if not ticks:
                    ticks = [rng.choice([a for a in ids if a != last])]
            else:  # one answer: right with probability p, else a wrong one (the first wrong one attracts most)
                if rng.random() < p or not wrong:
                    ticks = [right[0]] if right else [ids[0]]
                else:
                    ticks = [rng.choices(wrong, weights=[3] + [1] * (len(wrong) - 1))[0]]
                if names.get(q) == o["double"].get(str(student)):
                    others = [a for a in ids if a not in ticks]
                    ticks.append(rng.choice(others))
            faint = first and page == 1 and student in o["faint"]
            for a in ticks:
                box = next(co for aa, _, co in answers if aa == a)
                mark(draw, box, scale, 0.08 if faint else rng.uniform(0.45, 0.65), rng)
            summary["answers"].setdefault(str(student), {})[names.get(q) or str(q)] = ticks
            first = False
        if o["late"] == [student, page]:
            late = img
            continue
        images.append(img)
        if o["blank_after"] == [student, page]:
            images.append(Image.new("L", img.size, 252))

    for f in rendered:
        os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)
    main_pdf = os.path.join(out, f"scans-{o['class']}.pdf")
    images[0].save(main_pdf, save_all=True, append_images=images[1:], resolution=DPI)
    files = [main_pdf]
    if late is not None:
        late.save(os.path.join(out, "late-page.pdf"), resolution=DPI)
        files.append(os.path.join(out, "late-page.pdf"))
    summary["files"] = files
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
