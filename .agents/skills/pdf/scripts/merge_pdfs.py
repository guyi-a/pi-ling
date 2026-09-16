#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pypdf>=4.0",
# ]
# ///
"""
merge_pdfs.py —— 按顺序合并多个 PDF 成一份。

用法:
    uv run merge_pdfs.py --output MERGED.pdf INPUT1.pdf INPUT2.pdf [...]

行为:
    - inputs 按命令行顺序依次追加，页码不重排
    - 保留每份 PDF 的原分辨率、字体、注释
    - 遇到损坏 / 加密 PDF 会直接报错退出（不静默跳过），让用户明确处理

依赖: pypdf
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter


def main() -> None:
    p = argparse.ArgumentParser(description="Merge PDFs in the given order.")
    p.add_argument("--output", required=True, help="输出 PDF 路径")
    p.add_argument("inputs", nargs="+", help="输入 PDF 列表，按顺序合并")
    args = p.parse_args()

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    inputs = [Path(f).resolve() for f in args.inputs]
    missing = [str(f) for f in inputs if not f.exists()]
    if missing:
        sys.exit("以下文件不存在: " + ", ".join(missing))

    writer = PdfWriter()
    total_pages = 0
    for pdf_path in inputs:
        try:
            reader = PdfReader(str(pdf_path))
        except Exception as e:
            sys.exit(f"读取 {pdf_path} 失败: {type(e).__name__}: {e}")
        if reader.is_encrypted:
            sys.exit(f"{pdf_path} 被加密，先用 qpdf --decrypt 解开再合并")
        for page in reader.pages:
            writer.add_page(page)
            total_pages += 1

    with open(output_path, "wb") as f:
        writer.write(f)

    print(f"→ {output_path}  ({total_pages} pages, {len(inputs)} 份合并)")


if __name__ == "__main__":
    main()
