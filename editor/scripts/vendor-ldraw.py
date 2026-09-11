#!/usr/bin/env python3
"""
Vendor the LDraw parts the 3D viewer needs.

The complete LDraw library is 139MB and 37,000 files. The driving base needs
a few dozen of them, plus everything those recursively reference -- about
190 files and half a megabyte, which is small enough to commit so that
neither a contributor nor a classroom has to download the whole library.

    python3 scripts/vendor-ldraw.py               # vendor the parts
    python3 scripts/vendor-ldraw.py --measure     # print part bounding boxes

The parts are licensed CC BY 4.0 by their authors. Attribution is recorded in
ldraw/NOTICE, which this script regenerates.

LDraw geometry notes, because they trip everyone up:
  * 1 LDU = 0.4mm.
  * -Y is up. Y grows downward.
  * A part's origin is wherever its author put it, usually a natural
    attachment point, not the centre. Hence --measure.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

LIBRARY_URL = "https://library.ldraw.org/library/updates/complete.zip"
CACHED_ZIP = Path(os.environ.get("LDRAW_ZIP", "/tmp/ldraw-complete.zip"))

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "ldraw"
ROBOT = HERE.parent / "src" / "viewer" / "driving-base.json"

LDU_MM = 0.4


def ensure_library() -> zipfile.ZipFile:
    if not CACHED_ZIP.exists():
        print(f"Downloading the LDraw library to {CACHED_ZIP} (about 139MB, once)...")
        CACHED_ZIP.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(LIBRARY_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(request) as response, open(CACHED_ZIP, "wb") as out:
            shutil.copyfileobj(response, out)
    return zipfile.ZipFile(CACHED_ZIP)


class Library:
    """The LDraw archive, resolved the way the LDraw standard says to.

    A sub-file reference carries its own folder hint, and it matters:
    ``8\\3-8cylo.dat`` means the *low resolution* primitive in ``p/8/``, which
    is a different file from ``p/3-8cylo.dat``. Indexing by bare filename
    silently collapses the two, vendors whichever came first, and leaves the
    renderer asking for a file that was never copied.
    """

    def __init__(self, archive: zipfile.ZipFile):
        self.archive = archive
        self.paths = {name.lower(): name for name in archive.namelist()}

    def candidates(self, reference: str) -> list[str]:
        ref = reference.lower().replace("\\", "/").lstrip("./")

        if "/" in ref:
            head = ref.split("/", 1)[0]
            if head in ("48", "8"):
                return [f"ldraw/p/{ref}"]
            if head == "s":
                return [f"ldraw/parts/{ref}"]
            return [f"ldraw/parts/{ref}", f"ldraw/p/{ref}"]

        return [f"ldraw/parts/{ref}", f"ldraw/p/{ref}", f"ldraw/models/{ref}"]

    def read(self, reference: str) -> tuple[str, str] | None:
        """Return (archive path, text) for a sub-file reference, if it exists."""
        for candidate in self.candidates(reference):
            real = self.paths.get(candidate)
            if real is not None:
                return real, self.archive.read(real).decode("latin-1")
        return None


def sub_references(text: str) -> list[str]:
    """Names referenced by type-1 lines."""
    found = []
    for line in text.splitlines():
        fields = line.strip().split()
        if len(fields) >= 15 and fields[0] == "1":
            found.append(fields[14])
    return found


def resolve_tree(library: Library, roots: list[str]) -> dict[str, str]:
    """Every file the roots need, mapped from archive path to text."""
    collected: dict[str, str] = {}
    missing: list[str] = []
    queue = list(roots)
    seen: set[str] = set()

    while queue:
        reference = queue.pop()
        found = library.read(reference)
        if found is None:
            missing.append(reference)
            continue

        path, text = found
        # dedupe on the resolved path: two references can share a filename
        # and mean different files
        if path in seen:
            continue
        seen.add(path)

        collected[path] = text
        queue.extend(sub_references(text))

    if missing:
        raise SystemExit(f"These parts are not in the library: {sorted(set(missing))}")
    return collected


# --------------------------------------------------------------------------
# geometry, for placing parts sensibly
# --------------------------------------------------------------------------

def measure(library: Library, reference: str) -> dict:
    """Bounding box of a part in millimetres, in LDraw's own axes."""
    low = [float("inf")] * 3
    high = [float("-inf")] * 3

    def visit(name: str, matrix, depth=0):
        if depth > 12:
            return
        found = library.read(name)
        if not found:
            return
        for line in found[1].splitlines():
            fields = line.strip().split()
            if not fields:
                continue
            kind = fields[0]

            if kind == "1" and len(fields) >= 15:
                values = [float(v) for v in fields[2:14]]
                child = compose(matrix, values)
                visit(fields[14], child, depth + 1)

            elif kind in ("2", "3", "4") and len(fields) >= 8:
                count = {"2": 2, "3": 3, "4": 4}[kind]
                numbers = [float(v) for v in fields[2 : 2 + count * 3]]
                for index in range(count):
                    point = numbers[index * 3 : index * 3 + 3]
                    x, y, z = apply(matrix, point)
                    for axis, value in enumerate((x, y, z)):
                        low[axis] = min(low[axis], value)
                        high[axis] = max(high[axis], value)

    identity = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
    visit(reference, identity)

    if low[0] == float("inf"):
        return {"part": reference, "empty": True}

    return {
        "part": reference,
        "min_mm": [round(v * LDU_MM, 2) for v in low],
        "max_mm": [round(v * LDU_MM, 2) for v in high],
        "size_mm": [round((high[i] - low[i]) * LDU_MM, 2) for i in range(3)],
        "centre_mm": [round((high[i] + low[i]) / 2 * LDU_MM, 2) for i in range(3)],
    }


def compose(parent, child):
    """Combine two LDraw transforms, each [x,y,z, a,b,c, d,e,f, g,h,i]."""
    px, py, pz = parent[0:3]
    p = parent[3:12]
    cx, cy, cz = child[0:3]
    c = child[3:12]

    # translation of the child, rotated into the parent's frame
    tx = px + p[0] * cx + p[1] * cy + p[2] * cz
    ty = py + p[3] * cx + p[4] * cy + p[5] * cz
    tz = pz + p[6] * cx + p[7] * cy + p[8] * cz

    rotation = []
    for row in range(3):
        for column in range(3):
            rotation.append(
                p[row * 3 + 0] * c[0 * 3 + column]
                + p[row * 3 + 1] * c[1 * 3 + column]
                + p[row * 3 + 2] * c[2 * 3 + column]
            )
    return [tx, ty, tz, *rotation]


def apply(matrix, point):
    x, y, z = point
    t = matrix[0:3]
    m = matrix[3:12]
    return (
        t[0] + m[0] * x + m[1] * y + m[2] * z,
        t[1] + m[3] * x + m[4] * y + m[5] * z,
        t[2] + m[6] * x + m[7] * y + m[8] * z,
    )


# --------------------------------------------------------------------------

def parts_from_robot() -> list[str]:
    description = json.loads(ROBOT.read_text())
    return sorted({piece["part"] for piece in description["pieces"]})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--measure",
        nargs="*",
        metavar="PART",
        help="print bounding boxes instead of vendoring; defaults to the robot's parts",
    )
    args = parser.parse_args()

    library = Library(ensure_library())

    if args.measure is not None:
        for part in args.measure or parts_from_robot():
            box = measure(library, part)
            found = library.read(part)
            title = found[1].splitlines()[0][2:].strip() if found else "?"
            print(f"\n{part}  {title}")
            if box.get("empty"):
                print("  (no geometry)")
                continue
            print(f"  size   {box['size_mm']} mm  (x, y, z in LDraw axes, -Y is up)")
            print(f"  min    {box['min_mm']}")
            print(f"  max    {box['max_mm']}")
            print(f"  centre {box['centre_mm']}  <- offset of the part's origin")
        return 0

    roots = parts_from_robot()
    print(f"Resolving {len(roots)} parts: {', '.join(roots)}")
    collected = resolve_tree(library, roots)

    if OUT.exists():
        shutil.rmtree(OUT)
    total = 0
    for path, text in sorted(collected.items()):
        destination = OUT / Path(*Path(path).parts[1:])
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(text, encoding="latin-1")
        total += len(text)

    # the colour definitions, which LDrawLoader needs before any part
    config = library.archive.read("ldraw/LDConfig.ldr").decode("latin-1")
    (OUT / "LDConfig.ldr").write_text(config, encoding="latin-1")
    total += len(config)

    licence = library.archive.read("ldraw/CAreadme.txt").decode("latin-1")
    (OUT / "CAreadme.txt").write_text(licence, encoding="latin-1")

    (OUT / "NOTICE").write_text(
        "LDraw parts library\n"
        "===================\n\n"
        f"The {len(collected)} part and primitive files in this directory are taken\n"
        "unmodified from the LDraw Parts Library at https://library.ldraw.org/\n\n"
        "They are licensed CC BY 4.0 (a few, CC BY 2.0 and 4.0) by their individual\n"
        "authors, whose names are recorded in the 0 Author line of each file. See\n"
        "CAreadme.txt, and the full licence at\n"
        "https://creativecommons.org/licenses/by/4.0/\n\n"
        "Regenerate with: python3 scripts/vendor-ldraw.py\n\n"
        "LDraw is a trademark of the LDraw.org. LEGO is a trademark of The LEGO\n"
        "Group. Neither sponsors or endorses this project.\n",
        encoding="utf8",
    )

    print(f"Vendored {len(collected)} files, {total / 1024:.0f} KB, into {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
