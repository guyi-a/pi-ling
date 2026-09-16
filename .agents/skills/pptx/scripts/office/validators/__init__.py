"""
Validation modules for PPTX processing.

本项目精简版：只保留 PPTX 相关 validator，砍掉 DOCXSchemaValidator（本 skill 不管 docx）
和整个 XSD schema 校验层（1MB 的 OOXML schema 文件不打进 binary）。
"""

from .base import BaseSchemaValidator
from .pptx import PPTXSchemaValidator
from .redlining import RedliningValidator

__all__ = [
    "BaseSchemaValidator",
    "PPTXSchemaValidator",
    "RedliningValidator",
]
