"""
Command line tool to validate PPTX XML files (结构性校验 + 修订跟踪校验)。

本项目精简版：只处理 .pptx / .potx，砍掉 docx / xlsx 分支和 XSD schema 校验。
DOCX 走 docx skill；XSD 校验因为 1MB 的 schema 太大所以不带，靠 pack.py 的
auto-repair 兜住绝大多数场景。

用法：
    python validate.py <path> [--original <original_file>] [--auto-repair] [--author NAME]

path 可以是：
- 一个 unpacked 目录（内含 PPTX 的 XML）
- 一个 .pptx / .potx 文件（会解压到临时目录）

Auto-repair 修复：
- w:t 元素带空白但缺 xml:space="preserve"
"""

import argparse
import sys
import tempfile
import zipfile
from pathlib import Path

from helpers import OOXML_FAMILY
from validators import PPTXSchemaValidator, RedliningValidator


def main():
    parser = argparse.ArgumentParser(description="Validate PPTX XML files")
    parser.add_argument(
        "path",
        help="Path to unpacked directory or packed PPTX file (.pptx / .potx)",
    )
    parser.add_argument(
        "--original",
        required=False,
        default=None,
        help="Path to original .pptx / .potx file. If omitted, redlining validation is skipped.",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Enable verbose output",
    )
    parser.add_argument(
        "--auto-repair",
        action="store_true",
        help="Automatically repair common issues (whitespace preservation)",
    )
    parser.add_argument(
        "--author",
        default="Claude",
        help="Author name for redlining validation (default: Claude)",
    )
    args = parser.parse_args()

    path = Path(args.path)
    assert path.exists(), f"Error: {path} does not exist"

    original_file = None
    if args.original:
        original_file = Path(args.original)
        assert original_file.is_file(), f"Error: {original_file} is not a file"
        assert original_file.suffix.lower() in OOXML_FAMILY, (
            f"Error: {original_file} must be one of: {', '.join(sorted(OOXML_FAMILY))}"
        )

    family = OOXML_FAMILY.get((original_file or path).suffix.lower())
    assert family == "pptx", (
        f"Error: This validate.py only handles .pptx / .potx (got family={family}). "
        "For .docx use the docx skill."
    )

    if path.is_file() and path.suffix.lower() in OOXML_FAMILY:
        temp_dir = tempfile.mkdtemp()
        with zipfile.ZipFile(path, "r") as zf:
            zf.extractall(temp_dir)
        unpacked_dir = Path(temp_dir)
    else:
        assert path.is_dir(), f"Error: {path} is not a directory or PPTX file"
        unpacked_dir = path

    validators = [
        PPTXSchemaValidator(unpacked_dir, original_file, verbose=args.verbose),
    ]

    if args.auto_repair:
        total_repairs = sum(v.repair() for v in validators)
        if total_repairs:
            print(f"Auto-repaired {total_repairs} issue(s)")

    success = all(v.validate() for v in validators)

    if success:
        print("All validations PASSED!")

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
