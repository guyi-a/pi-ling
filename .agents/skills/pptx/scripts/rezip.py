"""Rewrite a .pptx with DEFLATE compression and no directory stubs.

Usage: python rezip.py <file.pptx> [output.pptx]

pptxgenjs writes every ZIP entry uncompressed (STORED) and adds an empty
directory entry for each folder, which bloats the file. This rewrites the
archive in place (or to a new path) with each file entry DEFLATE-compressed
and directory stubs dropped. File contents are unchanged.
"""

import sys
import zipfile
from pathlib import Path


def rezip(src: str, dst: str) -> None:
    src_path = Path(src)
    entries = []
    with zipfile.ZipFile(src_path, "r") as zin:
        for info in zin.infolist():
            if info.is_dir():
                continue
            entries.append((info, zin.read(info.filename)))

    dst_path = Path(dst)
    with zipfile.ZipFile(dst_path, "w", zipfile.ZIP_DEFLATED) as zout:
        for info, data in entries:
            out = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            out.external_attr = info.external_attr
            zout.writestr(out, data, zipfile.ZIP_DEFLATED)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    src = sys.argv[1]
    dst = sys.argv[2] if len(sys.argv) > 2 else src
    rezip(src, dst)
