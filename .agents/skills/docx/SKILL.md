---
name: docx
description: "Word 文档（.docx）的日常处理：md → docx（生成简历/报告）、docx → PDF/图片（分享预览）、.doc → .docx（老格式升级）。触发场景：用户说\"生成 Word 版\" / \"做份 Word 简历\" / \"把这份报告转 Word\" / \"这份 .doc 打不开\" / \"docx 转 PDF\" 等。读 docx 内容走 agent 已有的 extract_document_text 工具，不走本 skill。编辑现有 docx / 修订跟踪 / 批注这些重工作流本 skill 不支持。"
---

# Skill: docx（Word 文档轻量工具箱）

## 定位

面试助手场景里 Word 用得不多，本 skill 只做**生成 + 格式转换**这两件高频事，不做重型的编辑/修订/批注（那是法务级工作流，跟本产品定位不匹配）。

**能力清单**：

| 任务 | 路径 | 依赖 |
|---|---|---|
| **md → docx**（生成简历/报告）| `pandoc a.md -o a.docx` | pandoc |
| **md → docx（精调样式）** | `pandoc a.md -o a.docx --reference-doc=模板.docx` | pandoc |
| **docx → PDF**（分享/归档）| `soffice --headless --convert-to pdf a.docx` | LibreOffice |
| **docx → PDF**（兜底：没装 LibreOffice）| `pandoc a.docx -o a.pdf --pdf-engine=xelatex ...` | pandoc + xelatex |
| **docx → 图片**（预览）| docx → PDF 再 `pdftoppm -jpeg -r 150 a.pdf page` | LibreOffice + poppler |
| **.doc → .docx**（老格式升级）| `soffice --headless --convert-to docx a.doc` | LibreOffice |
| **读 docx 内容** | 用 agent 已有的 `extract_document_text` 工具 | 不走本 skill |
| ~~编辑现有 docx / 修订跟踪 / 批注~~ | **不支持** | 告诉用户在 Word 里手动改 |

---

## 路径 A：md → docx（99% 场景）

**默认命令**：

```
pandoc INPUT.md -o OUTPUT.docx
```

pandoc 默认样式对中文简历/报告已经够用（宋体、A4、标准页边距）。生成后必跑自检 SOP。

### 精调样式（可选）

用户想要特定字体/间距/边距，走 `--reference-doc`：

1. 让用户提供一份现有的 .docx 作为样式模板（比如公司的简历模板），或者从零造一份
2. `pandoc a.md -o a.docx --reference-doc=/path/to/template.docx`

pandoc 会**继承模板里的样式定义**（字体、字号、Heading 样式、页边距），把 md 内容按对应样式渲染进去。用户拿到的 Word 打开就是模板的样式。

**造模板的兜底做法**（用户没有现成模板时）：

```
# 先让 pandoc 吐一份默认模板出来
pandoc -o template.docx --print-default-data-file reference.docx
# 或者
pandoc -o template.docx /dev/null  # 生成一个空的默认样式 docx
```

然后**告诉用户**：用 Word 打开 `template.docx`，改字体/字号/边距，保存回来，再传给 pandoc `--reference-doc` 参数。**不要 agent 自己去改模板 docx 的 XML** —— 那是重工作流，本 skill 不做。

### 中文场景注意事项

- pandoc 默认对 CJK 字体支持已经 OK，中文段落不用特意配
- 如果生成后中文乱码或者变方框：让用户装了 pandoc 但没装 basictex/xelatex 引擎的可能性很大，或者 reference-doc 模板本身字体缺失
- Word 里中文字体名：**宋体**、**微软雅黑**、**苹方 SC**（macOS）—— 造模板时用这些

---

## 路径 B：docx → PDF（分享/归档）

**首选（推荐）**：

```
soffice --headless --convert-to pdf INPUT.docx --outdir OUT_DIR
```

macOS 上 `soffice` 二进制通常在 `/Applications/LibreOffice.app/Contents/MacOS/soffice`。如果 `which soffice` 找不到，就用绝对路径调。

**首次运行注意**：LibreOffice headless 首次会创建 user profile，可能慢 3-5 秒，第二次就快。

**兜底路径（用户没装 LibreOffice）**：

```
pandoc INPUT.docx -o OUTPUT.pdf \
    --pdf-engine=xelatex \
    -V CJKmainfont='PingFang SC' \
    -V geometry:margin=2cm
```

pandoc 走 xelatex 时 docx → PDF 支持基础样式，复杂图片/表格可能丢格式。soffice 保真度更高。

---

## 路径 C：docx → 图片（预览用）

两步走：

```
soffice --headless --convert-to pdf INPUT.docx --outdir /tmp
pdftoppm -jpeg -r 150 /tmp/INPUT.pdf /tmp/page
ls /tmp/page-*.jpg
```

- `-r 150` DPI 够读，太大文件飙升
- `pdftoppm` 会 zero-pad 页码到总页数宽度（12 页文档产出 `page-01.jpg`..`page-12.jpg`），用 `ls` 拿真实文件名再读，别硬拼

---

## 路径 D：.doc → .docx（老格式升级）

用户上传 .doc（Word 97-2003 老格式）时，`extract_document_text` 读不了、pandoc 也不认。先升级：

```
soffice --headless --convert-to docx INPUT.doc --outdir OUT_DIR
```

升完再走 `extract_document_text` 或后续处理。

---

## 依赖

**必需**：pandoc（pdf skill 已经要求装过）

**推荐**：LibreOffice
- macOS: `brew install --cask libreoffice`
- 用户没装时，路径 B 走 pandoc + xelatex 兜底；路径 C、D 直接告诉用户"这个转换需要装 LibreOffice"

**推荐**：Poppler（`pdftoppm`）
- macOS: `brew install poppler`（pdf skill 已要求过）
- 只用于路径 C

---

## Never（红线）

- **Never** 自己拆 docx 的 ZIP + 手改 XML —— 本 skill 明确不做编辑现有文档
- **Never** 用 python-docx 或 docx-js 从零画 docx —— 简历/报告 pandoc + md 够用了，多一层抽象没意义
- **Never** 告诉用户"docx 生成好了"而不跑自检
- **Never** 假设 `soffice` 装了就直接调 —— 先 `which soffice` 或 `command -v soffice`，没装走 pandoc 兜底或告诉用户装

---

## 自检 SOP

生成完必跑：

```
ls -lh <output.docx> && file <output.docx>
```

- `ls -lh` 看文件存在 + 大小合理（<1KB 是空文件）
- `file` 应看到 `Microsoft Word 2007+` 或 `Zip archive data`（.docx 本质是 ZIP）

想更保险，跑一次转 PDF 打开看：

```
soffice --headless --convert-to pdf <output.docx> --outdir /tmp && open /tmp/<output>.pdf
```

打得开就交付。

---

## 交付时给用户看的内容

- 产物**绝对路径**
- 大小 + 页数（用 `soffice` 转 PDF 后 `pdfinfo` 拿）
- 用到的路径（`pandoc` / `soffice`）
- 如果走了兜底（比如 LibreOffice 没装），**明确告诉用户**：产物是用什么方式转的，格式保真度可能差点儿

---

## 超出本 skill 范围的请求

用户如果要：

- **编辑现有 docx**（"把这份简历里的 X 改成 Y"）
- **修订跟踪 / 批注**（"给这份简历加红字批注告诉我该改哪里"）
- **精细样式操控**（"表格边框改成蓝色虚线"、"页眉加公司 logo"）

**告诉用户**：本 skill 不覆盖这些场景，建议做法：

1. 用 `extract_document_text` 读出简历内容
2. 让 agent 生成一份**修改后的 md**（含批注文字 / 修改标记）
3. `pandoc → docx` 或直接给用户 md
4. 具体的 Word 内批注 / 修订跟踪，让用户在 Word 里手动加

这条边界要跟用户说清楚，别硬撑着上重工作流。
