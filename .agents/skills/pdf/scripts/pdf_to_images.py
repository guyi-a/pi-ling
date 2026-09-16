#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pypdfium2>=4.0",
#     "Pillow>=10.0",
# ]
# ///
"""
pdf_to_images.py —— 把 PDF 每一页渲染成图片。

用法:
    uv run pdf_to_images.py --input INPUT.pdf --output-dir DIR [--scale 2.0] [--format png|jpg] [--pages 1-3,5]

参数:
    --input        输入 PDF
    --output-dir   输出目录（不存在会自动创建）
    --scale        渲染缩放。1.0 = 72 DPI；2.0 = 144 DPI（默认，看着清晰）；3.0 = 216 DPI（打印质）
    --format       png（默认，无损）或 jpg（有损但文件小）
    --pages        指定页范围（1-based），如 "1-3,5,7-9"；不传就渲染全部页
    --quality      仅 --format jpg 时用，1-100，默认 90

输出:
    每页一个文件：page_001.png / page_002.png / ...
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pypdfium2 as pdfium


def parse_page_spec(spec: str, total: int) -> list[int]:
    """把 '1-3,5,7-9' 展开成 [1,2,3,5,7,8,9]，1-based。总页数 total 用于范围校验。"""
    if not spec:
        return list(range(1, total + 1))
    out: list[int] = []
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            start, end = int(a), int(b)
            if start > end:
                sys.exit(f"invalid page range: {part}")
            for i in range(start, end + 1):
                out.append(i)
        else:
            out.append(int(part))
    for p in out:
        if p < 1 or p > total:
            sys.exit(f"page {p} out of range (1-{total})")
    return sorted(set(out))


def main() -> None:
    p = argparse.ArgumentParser(description="Render PDF pages to images.")
    p.add_argument("--input", required=True)
    p.add_argument("--output-dir", required=True)
    p.add_argument("--scale", type=float, default=2.0)
    p.add_argument("--format", choices=("png", "jpg", "jpeg"), default="png")
    p.add_argument("--pages", default="")
    p.add_argument("--quality", type=int, default=90)
    args = p.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        sys.exit(f"input 不存在: {input_path}")
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    fmt = args.format.lower()
    if fmt == "jpg":
        fmt = "jpeg"
    ext = "jpg" if fmt == "jpeg" else "png"

    pdf = pdfium.PdfDocument(str(input_path))
    total = len(pdf)
    pages = parse_page_spec(args.pages, total)

    saved: list[str] = []
    for page_num in pages:
        page = pdf[page_num - 1]
        bitmap = page.render(scale=args.scale)
        img = bitmap.to_pil()
        out_path = output_dir / f"page_{page_num:03d}.{ext}"
        if fmt == "jpeg":
            # RGB 强转，避免 RGBA 的 alpha 通道让 JPEG 编码器报错
            if img.mode != "RGB":
                img = img.convert("RGB")
            img.save(out_path, "JPEG", quality=args.quality)
        else:
            img.save(out_path, "PNG")
        saved.append(str(out_path))

    print(f"渲染完成: {len(saved)} 页 → {output_dir}")
    for s in saved:
        print(f"  {s}")


if __name__ == "__main__":
    main()
