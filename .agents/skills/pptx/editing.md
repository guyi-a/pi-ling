# pptx editing —— 基于模板编辑现有 PPT

**读到本文的前提**：用户手上有一份现成 pptx / potx 作为模板，你要复用它的样式，替换内容 / 增减幻灯片。

如果用户没有模板，走 `pptxgenjs.md` 从零画。

---

## 核心流程（严格 7 步，不要打乱顺序）

### 1. 分析模板

```
uv run <scripts_path>/thumbnail.py template.pptx
extract_document_text template.pptx  （agent 用工具，不走脚本）
```

- `thumbnail.py` 产出 `thumbnails.jpg`（多页拼成一张网格），用 `extract_document_text` 读这张图直接看有哪些 layout
- `extract_document_text template.pptx` 拿到每张 slide 的文字，看占位符和示例内容

**目的**：知道模板里有哪些 layout 可复用（标题页 / 章节页 / 两栏 / 图文 / 大数字 / 表格 / 结束页……）

### 2. 规划 slide 映射

对着用户要放的每一块内容，从模板挑一个匹配的 layout。

**关键**：**用多样化的 layout**。所有内容都塞成"标题 + 三行子弹"是最典型的失败模式。有意识地找：

- 多栏布局（2 栏 / 3 栏）
- 图 + 文组合
- 半出血图 + 文字叠加
- 引言 / 强调块
- 章节分隔页
- 大数字 / 大数据 callout
- 图标网格 / 图标 + 文字行

**内容类型匹配 layout**：
- 要点 → 子弹列表
- 团队信息 → 多栏
- 用户证言 → 引言样式
- 数据 → 大数字 callout
- 流程 → 时间线 / 步骤

### 3. Unpack

```
uv run <scripts_path>/office/unpack.py template.pptx unpacked/
```

会解压、美化 XML、把智能引号转成 XML 实体（防止编辑时被吃掉）。

### 4. 结构调整（先做完再进第 5 步）

- **删掉不要的 slide**：从 `ppt/presentation.xml` 的 `<p:sldIdLst>` 里移除对应 `<p:sldId>`
- **复用要用多次的 slide**：`uv run <scripts_path>/add_slide.py unpacked/ slide2.xml`（复制一份）
- **换 layout 生成新 slide**：`uv run <scripts_path>/add_slide.py unpacked/ slideLayout2.xml`（从 layout 建）
- **调整顺序**：编辑 `<p:sldIdLst>` 里 `<p:sldId>` 的排列

`add_slide.py` 会打印一个 `<p:sldId>` XML 片段，你手动插到 `<p:sldIdLst>` 期望的位置。

**⚠️ 结构改完再进第 5 步**。改内容中途插入 / 删除 slide 会打乱你已经改好的内容位置。

### 5. 编辑内容

一张一张改 `ppt/slides/slide{N}.xml`。

**用 apply_patch / write_file 工具直接改字符串，别写 Python 脚本去操作 XML**——脚本引入复杂度，Patch 的上下文修改清楚明白，回溯也方便。

**改每张 slide 的流程**：

1. Read slide 的 XML
2. 找出**所有**占位符 —— 文字、图片、图表、图标、说明
3. 逐个替换成真实内容

### 6. Clean

```
uv run <scripts_path>/clean.py unpacked/
```

清理孤儿数据：
- 不在 `<p:sldIdLst>` 里的 slide 文件
- 没被引用的媒体文件
- 孤立的 `.rels` 关系文件

**pack 前必跑**，不然文件会虚胖 + 有残留污染。

### 7. Pack

```
uv run <scripts_path>/office/pack.py unpacked/ output.pptx --original template.pptx
```

会跑结构校验、auto-repair（durableId、xml:space 之类）、条件式压缩 XML、把智能引号转回来。

`--original` 传原模板，用来对比参照（比如某些结构问题是原模板就有的，就不当新问题报）。

---

## .potx 模板

`.potx` 跟 `.pptx` 解压结构一样，直接 `unpack.py` 处理即可。pack 回去时保持 `.potx` 后缀：

```
uv run <scripts_path>/office/pack.py unpacked/ output.potx --original template.potx
```

后缀决定 Content Type，别搞错。

**模板里的图标 / 剪贴画**（SVG / EMF / PNG）在 `ppt/media/` 目录下，unpack → 改 → pack 全程保留，PowerPoint 打开时原生渲染。

**要复用模板里的图标**：**复制一整张含图标的 slide 或 layout**（用 `add_slide.py`），不要把图标文件抽出来再用 python-pptx `add_picture()` —— 那条路径不接受 SVG / EMF。

---

## 脚本速查

| 脚本 | 用途 | 常用命令 |
|---|---|---|
| `thumbnail.py` | 模板缩略图网格（分析用） | `uv run <scripts_path>/thumbnail.py input.pptx [prefix] [--cols N]`，默认 3 列，每张网格最多 12 slide |
| `office/unpack.py` | pptx → XML 目录 | `uv run <scripts_path>/office/unpack.py input.pptx unpacked/` |
| `add_slide.py` | 复制 slide 或从 layout 建 | `uv run <scripts_path>/add_slide.py unpacked/ slide2.xml`（复制）或 `slideLayout2.xml`（从 layout 建） |
| `clean.py` | 清理孤儿文件 | `uv run <scripts_path>/clean.py unpacked/` |
| `office/pack.py` | XML 目录 → pptx | `uv run <scripts_path>/office/pack.py unpacked/ output.pptx --original input.pptx` |

**注意**：`thumbnail.py` 只用于**模板分析阶段挑 layout**，产出的缩略图分辨率低。**视觉 QA 必须走 soffice + pdftoppm 出全分辨率图**，见 SKILL.md 的转图流程。

---

## Slide 操作细节

Slide 顺序在 `ppt/presentation.xml` 的 `<p:sldIdLst>`。

- **调顺序**：重排 `<p:sldId>` 元素
- **删 slide**：移除 `<p:sldId>` 元素，然后 `clean.py`
- **加 slide**：**必须**用 `add_slide.py`，不要手动 cp slide XML 文件 —— 手动复制会漏掉 `Content_Types.xml`、备注 slide 引用、关系 ID 这些跨文件的联动

---

## 内容编辑要点

### 格式规则

- **加粗**：标题、章节头、行内标签（"状态："、"说明：" 这种）—— 通过在 `<a:rPr>` 上设 `b="1"`
- **不要用 unicode bullet**（`•`）—— 用 `<a:buChar>` 或 `<a:buAutoNum>` 走正规列表机制
- **子弹一致性**：让子弹样式从 layout 继承，只在需要覆盖时才指定 `<a:buChar>` 或 `<a:buNone>`

### 多项内容一定要拆成多个 `<a:p>` 段落

用户内容是编号列表 / 多个小节时，**每一项独立 `<a:p>`**。**不要**把它们拼成一个字符串塞进一个 `<a:p>`。

**错误**（所有项挤在一起）：

```xml
<a:p><a:r><a:rPr .../><a:t>Step 1: 干第一件事。Step 2: 干第二件事。</a:t></a:r></a:p>
```

**正确**（分段 + 加粗标题）：

```xml
<a:p>
  <a:pPr algn="l"><a:lnSpc><a:spcPts val="3919"/></a:lnSpc></a:pPr>
  <a:r><a:rPr lang="zh-CN" sz="2799" b="1" .../><a:t>Step 1</a:t></a:r>
</a:p>
<a:p>
  <a:pPr algn="l"><a:lnSpc><a:spcPts val="3919"/></a:lnSpc></a:pPr>
  <a:r><a:rPr lang="zh-CN" sz="2799" .../><a:t>干第一件事。</a:t></a:r>
</a:p>
<a:p>
  <a:pPr algn="l"><a:lnSpc><a:spcPts val="3919"/></a:lnSpc></a:pPr>
  <a:r><a:rPr lang="zh-CN" sz="2799" b="1" .../><a:t>Step 2</a:t></a:r>
</a:p>
```

从原段落把 `<a:pPr>`（含行距 / 对齐）复制过来保持视觉一致，标题项用 `b="1"`。

### 智能引号

`unpack.py` / `pack.py` 会自动帮你转成 XML 实体（`&#x201C;` 等）—— 编辑时不会被 Edit 工具吃掉。

**新增带引号的文字要主动用 XML 实体**（因为 Edit 工具在写入时会把弯引号转成 ASCII 直引号）：

```xml
<a:t>所谓 &#x201C;协议&#x201D; 是指……</a:t>
```

| 字符 | 名称 | Unicode | XML 实体 |
|---|---|---|---|
| `“` | 左双引号 | U+201C | `&#x201C;` |
| `”` | 右双引号 | U+201D | `&#x201D;` |
| `‘` | 左单引号 | U+2018 | `&#x2018;` |
| `’` | 右单引号 / 撇号 | U+2019 | `&#x2019;` |

中文场景里用户可能更常用**「」『』**（书名号 / 引号），直接写 UTF-8 就行，`unpack/pack` 不会碰这些字符。

### 其他小坑

- **空白保留**：文字前后有空格 / tab 时，`<a:t>` 必须带 `xml:space="preserve"`。`validate.py --auto-repair` 会兜底修
- **别用 `xml.etree.ElementTree`** 手动读 XML —— 它会破坏命名空间。要写脚本就用 `defusedxml.minidom`

---

## 模板适配的常见坑

### 模板槽位数 ≠ 用户内容项数

模板里有 4 个团队成员位，用户只给 3 个人：**把第 4 个的整组元素（头像 + 姓名 + 职位 + 描述）全删掉**，不要只清空第 4 个的文字 —— 头像和边框还在，会成孤儿视觉元素。

清空后**必跑视觉 QA**验证没有残留形状。

### 替换文字长度不同

- **变短**：一般安全
- **变长**：容易溢出或意外换行

**长度显著变化后必跑视觉 QA**。塞不下就：截短、拆多张 slide、或者放大容器。

### 模板装饰依赖内容长度

比如标题下面有一根手绘的下划线，是按"标题一行"设计的；替换后标题变两行，下划线就错位了。**视觉 QA 时留意这类装饰错位**。

---

## 交付前跑一遍

1. `uv run <scripts_path>/office/validate.py output.pptx --auto-repair -v` —— 结构校验 + 自动修
2. 转图 + 主 agent 逐页看图（SKILL.md 的视觉 QA 流程）
3. `ls -lh` + `file` 确认文件正常
4. 有问题回到第 5 步局部修，再走一遍第 6-7 步（clean → pack）
