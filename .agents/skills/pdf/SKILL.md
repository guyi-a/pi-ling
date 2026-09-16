---
name: pdf
description: "PDF 相关的所有操作：从零生成（reportlab / pypdf）、格式转化（md/html → PDF）、修改（合并 / 拆分 / 旋转 / 加水印 / 提图片 / 元数据）、读内容（pdfplumber / extract_document_text）、OCR 扫描件、加密解密。触发场景：用户说\"生成 PDF\" / \"做份 PDF 简历\" / \"合并这几份 PDF\" / \"给 PDF 加水印\" / \"这份扫描 PDF 转文字\" / \"提取 PDF 表格\" / \"精调 PDF 样式\"等一切跟 .pdf 文件相关的活。这个 skill 是工具箱：说明书 + 预置可执行脚本 + 命令模板。冷门场景看 REFERENCE.md。"
---

# Skill: pdf (PDF 全能工具箱)

**skill 目录布局**：

- `SKILL.md`（本文档）—— 日常够用的核心
- `REFERENCE.md` —— 进阶：详细库用法、复杂场景、性能优化。遇冷门需求时 `read_file <skill_path>/REFERENCE.md`
- `scripts/` —— 预置可执行脚本，用 `run_command uv run <scripts_path>/xxx.py <args>` 调用
- **不要修改本目录里的脚本**。要定制先 `cp` 到 `workspace/scripts/` 再改

## Quick Reference（任务 → 路径）

| 任务 | 首选路径 | 备注 |
|---|---|---|
| **md → PDF**（快速，样式默认） | `pandoc a.md -o a.pdf --pdf-engine=xelatex -V CJKmainfont='PingFang SC' -V fontsize=12pt -V linestretch=1.4 -V geometry:margin=2cm` | 需 pandoc + xelatex/typst |
| **md/html → PDF**（精调，重视觉） | agent 写完整 html（内嵌 CSS）→ `uv run <scripts_path>/html_to_pdf.py --input a.html --output a.pdf` | Chromium headless |
| **从零画 PDF**（发票/证书/精确布局） | reportlab（下方"从零 draw"章节） | Canvas 或 Platypus |
| **读 PDF 内容**（提文字） | 用 agent 已有的 `extract_document_text` 工具 | 不走脚本 |
| **提取表格** | pdfplumber（下方"提取内容"章节） | 保留结构 |
| **合并多个 PDF** | `uv run <scripts_path>/merge_pdfs.py --output merged.pdf a.pdf b.pdf c.pdf` | pypdf |
| **PDF 拆成图片** | `uv run <scripts_path>/pdf_to_images.py --input a.pdf --output-dir images/` | pypdfium2 |
| **PDF 按页拆分** | `qpdf --split-pages=1 input.pdf out_%d.pdf` | 一条命令 |
| **旋转某页** | `qpdf input.pdf output.pdf --rotate=+90:1` | 一条命令 |
| **加水印** | reportlab 造水印 PDF + pypdf 叠加（下方"加水印"章节） | 需要写点脚本 |
| **提元数据** | pypdf `reader.metadata`（下方"元数据"章节） | |
| **加密/解密** | pypdf `writer.encrypt` / qpdf `--decrypt` | 见下方 |
| **OCR 扫描 PDF** | pytesseract + pdf2image（下方"OCR"章节） | `brew install tesseract tesseract-lang` |
| **提取内嵌图片** | `pdfimages -all input.pdf images/img` | poppler-utils |
| **复杂/冷门场景** | 看 `REFERENCE.md` | JS 库、pypdfium2 高级、qpdf 高级、性能 |

---

## 转化：md/html → PDF（我们的核心能力）

### 决定走哪条路：**必须**先用 ask_user 问一次

md/html → PDF **总是**有"快速一发"和"精调 HTML"两种走法，agent 无法从技术层面替用户决定 —— **必须调 ask_user 让用户挑一次**，除非用户已经明说了偏好。

```
ask_user(questions=[{
  "question": "PDF 样式偏好？",
  "options": [
    "精调样式，走 HTML 渲染，排版最好 (Recommended)",
    "快速一发，pandoc 默认样式就够"
  ]
}])
```

推荐项是**精调**：HTML → Chromium 的排版质量明显高于 pandoc 默认（CSS 精调空间大、字体渲染细腻、可控 layout），除非用户明确要"快速临时看看"，都应该默认走 HTML。

选"精调" → 路径 B（html→Chromium）
选"快速" → 路径 A（pandoc）

**不能跳过 ask_user**：即使你觉得"根据上下文能猜到用户想要精调"，也要问一次 —— PDF 是要交付的产物，用户对排版预期比 agent 猜测准。**唯一可跳过的情况**是用户在这条消息里已经写明了"快速一发 / 就要好看 / 用于投递 / 用于打印"这类明确信号，直接按信号走对应路径。

### 路径 A：pandoc 快速（默认样式）

适用：**agent 判断"用户只是快速看看，不在意视觉设计"**。

```
pandoc INPUT.md -o OUTPUT.pdf \
    --pdf-engine=xelatex \
    -V CJKmainfont='PingFang SC' \
    -V fontsize=12pt \
    -V linestretch=1.4 \
    -V geometry:margin=2cm
```

依赖：`brew install pandoc && brew install --cask basictex`（或 `brew install typst` 换 `--pdf-engine=typst`）。

### 路径 B：html → Chromium（精调）

适用：**用户在意视觉设计**。简历自评报告分享、演讲讲义、需要"设计感"的产物。

**流程**：

1. `read_file` 看 md 内容和结构
2. `write_file` 写一份完整的 html（内嵌 `<style>` + `@page` 规则 + 中文字体 + 精调 layout），md 内容手动搬进 `<h1>` / `<p>` / `<table>` 等
3. `run_command uv run <scripts_path>/html_to_pdf.py --input a.html --output a.pdf`

**关键：不要走 `pandoc a.md -o a.html` 再转 PDF**。pandoc 的默认 html template 没有精调样式，跟直接 pandoc→PDF 一样素。html 必须是**agent 亲手编排的**。

**html 骨架模板**（agent 起点）：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>标题</title>
<style>
  @page { size: A4; margin: 2cm; }
  body {
    font-family: 'PingFang SC', 'Microsoft YaHei', -apple-system, sans-serif;
    font-size: 12pt; line-height: 1.7; color: #222;
  }
  h1 { color: #1e3c78; border-bottom: 2px solid #1e3c78; padding-bottom: 0.3em; margin-top: 1.5em; }
  h2 { color: #2c5aa0; margin-top: 1.2em; padding-left: 8px; border-left: 4px solid #2c5aa0; }
  code { background: #f4f7fa; padding: 2px 6px; border-radius: 3px; font-family: 'SF Mono', Menlo, monospace; }
  pre { background: #f4f7fa; padding: 12px 16px; border-radius: 6px; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f4f7fa; font-weight: 600; }
  blockquote { border-left: 4px solid #ccc; padding-left: 1em; color: #666; margin-left: 0; }
  .page-break { page-break-before: always; }
</style>
</head>
<body>
  <!-- 内容 -->
</body>
</html>
```

依赖：用户装了 Chrome（macOS 几乎必装）。没装引导 `https://www.google.com/chrome/`。

---

## 从零 draw PDF（reportlab）

适用：**发票 / 证书 / 结业通知 / 精确布局的表单**——需要 pixel-精确定位的产物。

**依赖 PEP 723 声明**：`"reportlab>=4.0"`

### Canvas 简单版（低层 API，控制精细）

```python
# /// script
# dependencies = ["reportlab>=4.0"]
# ///
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# 注册 CJK 字体（macOS）
pdfmetrics.registerFont(TTFont('CN', '/System/Library/Fonts/STHeiti Light.ttc'))

c = canvas.Canvas("out.pdf", pagesize=A4)
w, h = A4  # 595 x 842 pt

c.setFont('CN', 24)
c.drawString(50, h - 80, "标题")

c.setFont('CN', 12)
c.drawString(50, h - 120, "正文段落 —— 靠 drawString 精确定位")

# 画线 / 矩形 / 圆
c.line(50, h - 140, w - 50, h - 140)
c.rect(50, h - 200, 200, 40, stroke=1, fill=0)
c.setFillColorRGB(0.9, 0.9, 0.9)
c.rect(50, h - 260, 200, 40, stroke=0, fill=1)

c.showPage()  # 结束当前页
c.save()
```

### Platypus 组件流（高层 API，自动分页）

```python
# /// script
# dependencies = ["reportlab>=4.0"]
# ///
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
from reportlab.lib import colors
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont('CN', '/System/Library/Fonts/STHeiti Light.ttc'))

doc = SimpleDocTemplate("report.pdf", pagesize=A4,
                        leftMargin=50, rightMargin=50, topMargin=60, bottomMargin=60)

# 自定义中文样式（默认样式没设 CJK 字体）
styles = getSampleStyleSheet()
cn_title = ParagraphStyle('CNTitle', parent=styles['Title'], fontName='CN', fontSize=22)
cn_body = ParagraphStyle('CNBody', parent=styles['Normal'], fontName='CN', fontSize=11, leading=18)

story = []
story.append(Paragraph("报告标题", cn_title))
story.append(Spacer(1, 20))
story.append(Paragraph("这是正文内容 —— Platypus 会自动分页、换行、对齐。" * 5, cn_body))
story.append(PageBreak())

# 表格
data = [
    ['项目', 'Q1', 'Q2', 'Q3', 'Q4'],
    ['营收', '100', '120', '135', '160'],
    ['利润', '20', '25', '30', '40'],
]
table = Table(data)
table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3c78')),
    ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
    ('FONTNAME', (0, 0), (-1, -1), 'CN'),
    ('FONTSIZE', (0, 0), (-1, 0), 13),
    ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
    ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#f4f7fa')),
]))
story.append(table)

doc.build(story)
```

**Never** 在 reportlab 里用 Unicode 上下标（`x²`、`H₂O` 的 ² ₂）—— 内置字体没有这些 glyph，会渲染成黑色实心方块。用 `<sub>` / `<super>` Paragraph 标签：

```python
Paragraph("H<sub>2</sub>O 和 x<super>2</super>", cn_body)
```

---

## Python 操作 PDF（pypdf）

### 合并 PDF

用预置脚本：

```
uv run <scripts_path>/merge_pdfs.py --output merged.pdf a.pdf b.pdf c.pdf
```

即席代码：

```python
# /// script
# dependencies = ["pypdf>=4.0"]
# ///
from pypdf import PdfReader, PdfWriter

writer = PdfWriter()
for path in ["a.pdf", "b.pdf", "c.pdf"]:
    for page in PdfReader(path).pages:
        writer.add_page(page)
with open("merged.pdf", "wb") as f:
    writer.write(f)
```

### 按页拆分

```python
reader = PdfReader("input.pdf")
for i, page in enumerate(reader.pages):
    w = PdfWriter()
    w.add_page(page)
    with open(f"page_{i+1}.pdf", "wb") as f:
        w.write(f)
```

或者命令行：`qpdf --split-pages=1 input.pdf out_%d.pdf`

### 旋转

```python
reader = PdfReader("input.pdf")
writer = PdfWriter()
for page in reader.pages:
    page.rotate(90)  # 90 / 180 / 270
    writer.add_page(page)
with open("rotated.pdf", "wb") as f:
    writer.write(f)
```

或命令行：`qpdf input.pdf out.pdf --rotate=+90:1-3`（1-3 页转 90 度）

### 提元数据

```python
reader = PdfReader("input.pdf")
m = reader.metadata
print(m.title, m.author, m.subject, m.creator)
print(f"页数: {len(reader.pages)}")
```

### 加密 / 解密

```python
# 加密
writer = PdfWriter()
for page in PdfReader("input.pdf").pages:
    writer.add_page(page)
writer.encrypt(user_password="user", owner_password="owner")
with open("encrypted.pdf", "wb") as f:
    writer.write(f)

# 解密
reader = PdfReader("encrypted.pdf")
if reader.is_encrypted:
    reader.decrypt("user")
# 之后正常读
```

命令行解密：`qpdf --password=secret --decrypt encrypted.pdf out.pdf`

---

## 加水印

两步：**用 reportlab 造一张透明水印 PDF**，再用 pypdf 叠加。

```python
# /// script
# dependencies = ["reportlab>=4.0", "pypdf>=4.0"]
# ///
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader, PdfWriter

# Step 1: 造水印 PDF
pdfmetrics.registerFont(TTFont('CN', '/System/Library/Fonts/STHeiti Light.ttc'))
c = canvas.Canvas("_wm.pdf", pagesize=A4)
w, h = A4
c.saveState()
c.translate(w / 2, h / 2)
c.rotate(45)
c.setFillColorRGB(0.6, 0.6, 0.6, alpha=0.25)  # 灰色 25% 透明
c.setFont('CN', 60)
c.drawCentredString(0, 0, "CONFIDENTIAL")
c.restoreState()
c.save()

# Step 2: 叠加到每一页
watermark = PdfReader("_wm.pdf").pages[0]
reader = PdfReader("input.pdf")
writer = PdfWriter()
for page in reader.pages:
    page.merge_page(watermark)
    writer.add_page(page)
with open("watermarked.pdf", "wb") as f:
    writer.write(f)
```

---

## 提取内容

### 提文字（简单）

用 agent 已有的 `extract_document_text` 工具（不走本 skill）。

### 提文字（保 layout）

```python
# /// script
# dependencies = ["pdfplumber>=0.11"]
# ///
import pdfplumber

with pdfplumber.open("input.pdf") as pdf:
    for i, page in enumerate(pdf.pages):
        print(f"--- Page {i+1} ---")
        print(page.extract_text())
```

命令行版：`pdftotext -layout input.pdf output.txt`

### 提表格

```python
# /// script
# dependencies = ["pdfplumber>=0.11", "pandas>=2.0"]
# ///
import pdfplumber
import pandas as pd

with pdfplumber.open("input.pdf") as pdf:
    all_tables = []
    for page in pdf.pages:
        for table in page.extract_tables():
            if table and len(table) > 1:
                df = pd.DataFrame(table[1:], columns=table[0])
                all_tables.append(df)

if all_tables:
    combined = pd.concat(all_tables, ignore_index=True)
    combined.to_excel("tables.xlsx", index=False)
```

### 提图片

命令行：`pdfimages -all input.pdf images/img`（poppler-utils，最快）

---

## OCR 扫描 PDF

依赖：`brew install tesseract tesseract-lang poppler`。中文语言包（`chi_sim`）在 `tesseract-lang` 里。

```python
# /// script
# dependencies = ["pytesseract", "pdf2image"]
# ///
from pytesseract import image_to_string
from pdf2image import convert_from_path

for i, img in enumerate(convert_from_path("scanned.pdf")):
    print(f"--- Page {i+1} ---")
    print(image_to_string(img, lang="chi_sim+eng"))
```

---

## CJK 字体（生成含中文 PDF 必读）

**⚠️ reportlab 独家坑**：`PingFang.ttc` 内部是 **PostScript CFF outlines** 格式，
reportlab 的 `TTFont` 只支持 TrueType，加载 PingFang 会失败（报 `not a supported
TrueType font file` 或类似错误）。**给 reportlab 用 CJK 字体时不要选 PingFang**，
用 STHeiti 或 Songti。

**reportlab 能用的 macOS 系统 CJK 字体路径**（都是 TrueType）：

- `/System/Library/Fonts/STHeiti Light.ttc` — 华文黑体细体，**推荐**
- `/System/Library/Fonts/STHeiti Medium.ttc` — 华文黑体中等
- `/System/Library/Fonts/Supplemental/Songti.ttc` — 宋体（可能不在，视系统版本）

**pandoc / html→Chromium 场景没这个限制**（xelatex 走 fontspec 支持 PS，Chromium
直接用系统渲染），可以直接用 `PingFang SC`。

**各场景字体传法总表**：

| 场景 | 字体名 / 传法 | 说明 |
|---|---|---|
| pandoc | `-V CJKmainfont='PingFang SC'` | 系统字体名，PS 也行 |
| html + Chromium | CSS `font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;` | 系统字体名，PS 也行 |
| reportlab | `pdfmetrics.registerFont(TTFont('CN', '/System/Library/Fonts/STHeiti Light.ttc'))` 再 `setFont('CN', 12)` | **绝对路径**，且**必须 TrueType**，不能用 PingFang.ttc |
| Pillow | `ImageFont.truetype('/System/Library/Fonts/STHeiti Light.ttc', 24)` | 绝对路径，Pillow 也不支持 PS outlines |

**macOS 默认可用字体名**（pandoc / CSS 场景直接叫名字，不用路径）：

- `PingFang SC` — 苹方，推荐
- `Heiti SC` — 黑体
- `Songti SC` — 宋体
- `STHeiti` — 华文黑体

---

## Never（红线）

- **Never** 用 fpdf2 或类似库自己实现 markdown → PDF 渲染器 —— pandoc / reportlab / Chromium 是本职
- **Never** 走 `pandoc md → html → chromium PDF` —— pandoc 默认 html template 没精调样式，等于白转
- **Never** 修改本 skill 目录里的脚本 —— 要定制先 `cp` 到 workspace 再改
- **Never** 在没跑自检的情况下告诉用户"PDF 做好了"
- **Never** 在 reportlab 里直接写 Unicode 上下标（用 `<sub>` / `<super>`）

## 自检 SOP

生成完必跑：

```
ls -lh <output.pdf> && file <output.pdf>
```

- `ls -lh` 看文件存在 + 大小合理（<1KB 是空文件）
- `file` 看 magic 是否 `PDF document`

装了 poppler 可以 `pdfinfo <output.pdf>` 拿页数。

## 交付时给用户看的内容

- 产物文件的**绝对路径**
- 大小 + 页数
- 用到的路径（`pandoc xelatex` / `html + Chromium` / `reportlab Canvas` / 具体脚本名）
- 可调参数提示（字号 / 行距 / 边距 / CSS 变量）—— 让用户能进一步调
