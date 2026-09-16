# PDF 处理进阶手册

SKILL.md 里没覆盖的冷门 / 进阶场景。日常用不到，agent 遇到特殊需求时 `read_file <skill_path>/REFERENCE.md` 补充。

## pypdfium2（快速渲染库）

Chromium 的 PDF 引擎（PDFium）的 Python 绑定。**比 pypdf 快 5-10 倍**，用于渲染、大 PDF 处理。

依赖：`pypdfium2>=4.0`

### 渲染 PDF 为图片（比 pdf_to_images.py 更细控）

```python
# /// script
# dependencies = ["pypdfium2>=4.0", "Pillow>=10"]
# ///
import pypdfium2 as pdfium

pdf = pdfium.PdfDocument("input.pdf")

for i, page in enumerate(pdf):
    bitmap = page.render(
        scale=3.0,          # 越高越清晰。1.0=72dpi, 2.0=144dpi, 3.0=216dpi（打印质）
        rotation=0,         # 0/90/180/270
        crop=(50, 50, 50, 50),  # 上下左右各裁 50 pt
        greyscale=False,
        fill_color=(255, 255, 255, 255),  # 背景色
    )
    img = bitmap.to_pil()
    img.save(f"page_{i+1}.png", "PNG")
```

### 直接提文字（不走 pdfplumber）

```python
pdf = pdfium.PdfDocument("input.pdf")
for i, page in enumerate(pdf):
    text = page.get_text()
    print(f"--- Page {i+1} ---\n{text}")
```

## qpdf 高级

### 复杂页范围

```
qpdf input.pdf --pages input.pdf 1,3-5,8,10-end -- extracted.pdf
```

### 多 PDF 交叉合并

```
qpdf --empty --pages doc1.pdf 1-3 doc2.pdf 5-7 doc3.pdf 2,4 -- combined.pdf
```

### 优化 / 压缩

```
qpdf --linearize input.pdf optimized.pdf                # 优化 web 传输
qpdf --optimize-images --compress-streams=y in.pdf out.pdf  # 压缩内嵌资源
```

### 检查 / 修复损坏 PDF

```
qpdf --check corrupted.pdf                # 只检查
qpdf --replace-input corrupted.pdf         # 就地修复
```

### 加密（精细权限）

```
qpdf --encrypt user_pass owner_pass 256 \
     --print=none --modify=none --extract=none \
     -- input.pdf encrypted.pdf
```

`256` 是 AES-256 加密强度（选 40/128/256）。

### 查加密状态

```
qpdf --show-encryption encrypted.pdf
```

## pdfplumber 高级

### 提取带坐标的字符

```python
# /// script
# dependencies = ["pdfplumber>=0.11"]
# ///
import pdfplumber

with pdfplumber.open("input.pdf") as pdf:
    page = pdf.pages[0]
    # 每个字符的坐标（左下角原点）
    for char in page.chars[:20]:
        print(f"'{char['text']}' at ({char['x0']:.1f}, {char['y0']:.1f})")
```

### 按 bounding box 提文字

```python
with pdfplumber.open("input.pdf") as pdf:
    page = pdf.pages[0]
    # 只提左上角这块 (left, top, right, bottom)
    region = page.within_bbox((100, 100, 400, 200))
    text = region.extract_text()
```

### 复杂表格的自定义设置

```python
table_settings = {
    "vertical_strategy": "lines",         # 用 PDF 里的实际线定表格边界
    "horizontal_strategy": "lines",
    "snap_tolerance": 3,                  # 线的容差
    "intersection_tolerance": 15,
    "min_words_vertical": 3,              # 至少 3 个词才算一列
}
tables = page.extract_tables(table_settings)

# 视觉调试（把识别的表格边界画出来）
img = page.to_image(resolution=150)
img.debug_tablefinder(table_settings).save("debug.png")
```

策略选项：`lines`（有实际画线）/ `text`（无线，靠文字对齐）/ `explicit`（自己传坐标）

## reportlab 高级

### 自定义 Flowable（Platypus 组件）

内置的 Paragraph / Table / Spacer / Image 不够用时，写自定义组件：

```python
from reportlab.platypus import Flowable
from reportlab.lib.colors import HexColor

class ColoredBar(Flowable):
    """一个可复用的彩色横条 flowable。"""
    def __init__(self, width, height, color):
        Flowable.__init__(self)
        self.width, self.height, self.color = width, height, color

    def draw(self):
        self.canv.setFillColor(HexColor(self.color))
        self.canv.rect(0, 0, self.width, self.height, fill=1, stroke=0)

# 用法：
story.append(ColoredBar(500, 3, "#1e3c78"))
```

### 页眉 / 页脚（Platypus）

```python
def on_each_page(canvas, doc):
    """每页调用。canvas 是低层 API，可以随便画。"""
    canvas.saveState()
    canvas.setFont('CN', 9)
    canvas.setFillColorRGB(0.5, 0.5, 0.5)
    # 页眉
    canvas.drawString(50, A4[1] - 30, "面试自评报告")
    # 页脚 —— 页码
    canvas.drawCentredString(A4[0]/2, 30, f"— {doc.page} —")
    canvas.restoreState()

doc.build(story, onFirstPage=on_each_page, onLaterPages=on_each_page)
```

### 图片嵌入

```python
from reportlab.platypus import Image
img = Image("photo.jpg", width=200, height=150)
story.append(img)
```

## 命令行进阶

### pdftotext 保精确坐标

```
pdftotext -bbox-layout input.pdf output.xml
```

输出的 XML 里每个 word 都带精确坐标，适合做结构化抽取。

### pdftoppm 高分辨率转图片

```
pdftoppm -png -r 300 input.pdf out_prefix          # 300 dpi
pdftoppm -jpeg -jpegopt quality=85 -r 200 in.pdf p  # jpeg 85%
pdftoppm -f 1 -l 3 -r 600 in.pdf p                  # 只转 1-3 页，600 dpi
```

### pdfimages 提图元信息

```
pdfimages -list input.pdf                # 只列表不提取
pdfimages -all input.pdf images/         # 提取所有图 + 保留原格式
pdfimages -j -p input.pdf images/        # 只提 JPEG，文件名带页号
```

## 性能优化

### 大 PDF 分块处理

```python
def process_in_chunks(pdf_path, chunk_size=10):
    reader = PdfReader(pdf_path)
    total = len(reader.pages)
    for start in range(0, total, chunk_size):
        end = min(start + chunk_size, total)
        writer = PdfWriter()
        for i in range(start, end):
            writer.add_page(reader.pages[i])
        with open(f"chunk_{start//chunk_size}.pdf", "wb") as f:
            writer.write(f)
```

### 提文字性能对比（快 → 慢）

1. `pdftotext -layout`（命令行）— 最快，纯文本
2. `pypdfium2 page.get_text()` — 快，Python
3. `pdfplumber page.extract_text()` — 中，但支持坐标 / 表格
4. `pypdf page.extract_text()` — 慢，不推荐用于大文档

### 渲染图片性能

1. `pdfimages`（提内嵌图，直接读原图）— 最快
2. `pdftoppm`（渲染整页）— 中，命令行
3. `pypdfium2` — 中，Python 灵活
4. `pdf2image`（走 poppler，Python）— 慢，多进程会好一些

## 故障排查

### 提文字全是空 / 乱码

**原因**：这是扫描 PDF（图片型），文字层不存在。

**解决**：走 OCR（SKILL.md 里的 pytesseract 章节），或者用 `ocrmypdf` 工具重建搜索层：

```
brew install ocrmypdf
ocrmypdf -l chi_sim+eng scanned.pdf ocrd.pdf
```

### 加密 PDF 读不了

```python
reader = PdfReader("encrypted.pdf")
if reader.is_encrypted:
    result = reader.decrypt("password")  # 返回 0 失败 / 1 用户密码 / 2 拥有者密码
    if result == 0:
        raise ValueError("密码错误")
```

或命令行：`qpdf --password=xxx --decrypt in.pdf out.pdf`

### 损坏 PDF

```
qpdf --check bad.pdf              # 看错在哪
qpdf --replace-input bad.pdf      # 尝试就地修复
```

### 中文提出来是乱码 / 空

- pypdf `extract_text()` 对某些编码嵌入的 PDF 支持不好 → 换 pdfplumber
- pdfplumber 也不行 → 说明 PDF 里用了 CID 字体但没嵌入 ToUnicode 映射 → 只能 OCR

## JS 库（备选）

如果 agent 在 Node.js 环境里工作（我们目前不是），可以用 pdf-lib：

- `pdf-lib`（MIT）：JS 里创建 / 修改 PDF，跨环境（浏览器 + Node）
- `pdfjs-dist`（Apache）：Mozilla 出的浏览器 PDF 渲染器

我们目前用 Python 生态，这两个只在特殊场景（比如做前端预览）才会碰。

## 依赖装失败

参考 python-scripting skill 的通用诊断。对 PDF 特有的：

- pypdfium2 装不上 → 检查 python 版本 ≥ 3.8
- pdfplumber 需要 pillow → 通常 uv 会自动装
- pytesseract 需要 tesseract 二进制 → `brew install tesseract tesseract-lang`
- pdf2image 需要 poppler 二进制 → `brew install poppler`
- reportlab 装完但字体报错 → 需要 `pdfmetrics.registerFont()` 注册 CJK 字体路径（见 SKILL.md CJK 章节）

## Licence 简表

- pypdf: BSD
- pdfplumber: MIT
- pypdfium2: Apache/BSD
- reportlab: BSD
- poppler-utils: GPL-2
- qpdf: Apache
- tesseract: Apache-2
- pdf-lib: MIT
- pdfjs-dist: Apache
