#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
html_to_pdf.py —— Chromium headless 把 HTML 打印成 PDF。

用法:
    uv run html_to_pdf.py --input INPUT.html --output OUTPUT.pdf [--chrome CHROME_PATH]

行为:
    - 优先自动定位 Chrome 二进制（macOS 默认路径），可用 --chrome 覆盖
    - html 路径转成 file:// URL 传给 Chrome
    - 关闭 Chrome 默认的页眉页脚（url、日期），只留纯 HTML 内容
    - 出错时打印 Chrome stderr 到标准错误，返回非零退出码

依赖: 无 python 库依赖，纯 subprocess 调用 Chrome
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

# macOS 上 Chrome / Chromium / Edge 的常见二进制路径。按优先级排。
DEFAULT_CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
]


def locate_chrome(explicit: str | None) -> str:
    if explicit:
        if not Path(explicit).exists():
            sys.exit(f"chrome binary not found: {explicit}")
        return explicit
    # 先看 PATH
    for name in ("chrome", "chromium", "google-chrome"):
        found = shutil.which(name)
        if found:
            return found
    # macOS 常见路径
    for cand in DEFAULT_CHROME_CANDIDATES:
        if Path(cand).exists():
            return cand
    sys.exit(
        "Chrome / Chromium 未找到。请安装 Chrome：\n"
        "  https://www.google.com/chrome/\n"
        "或者用 --chrome 显式指定二进制路径。"
    )


def main() -> None:
    p = argparse.ArgumentParser(description="Print an HTML file to PDF via Chromium headless.")
    p.add_argument("--input", required=True, help="输入 HTML 文件路径（可以是相对路径）")
    p.add_argument("--output", required=True, help="输出 PDF 文件路径")
    p.add_argument("--chrome", help="Chrome/Chromium 二进制路径；默认自动定位")
    p.add_argument("--timeout", type=int, default=60, help="Chrome 超时（秒），默认 60")
    args = p.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        sys.exit(f"input html 不存在: {input_path}")
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    chrome = locate_chrome(args.chrome)
    file_url = "file://" + str(input_path)

    cmd = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-pdf-header-footer",
        f"--print-to-pdf={output_path}",
        file_url,
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=args.timeout,
        )
    except subprocess.TimeoutExpired:
        sys.exit(f"Chrome 超时（{args.timeout}s），HTML 可能包含长时间加载资源")

    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        sys.exit(f"Chrome 退出非零: {result.returncode}")

    if not output_path.exists() or output_path.stat().st_size == 0:
        sys.exit(f"输出 PDF 未生成或为空: {output_path}")

    size = output_path.stat().st_size
    print(f"→ {output_path}  ({size} bytes)")


if __name__ == "__main__":
    main()
