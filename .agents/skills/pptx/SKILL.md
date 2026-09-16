---
name: pptx
description: "PowerPoint 幻灯片（.pptx / .potx）的所有操作：从零生成（pptxgenjs Node 库）、基于模板编辑（unpack XML → 改 → clean → pack）、格式转化（pptx → PDF / 图片、.ppt → .pptx）、读取分析。触发场景：用户说\"做份 PPT\" / \"生成幻灯片\" / \"演讲 slide\" / \"培训材料\" / \"项目汇报\" / \"给我这个模板换内容\" / \"pptx 转 PDF\" / \".ppt 打不开\" 等一切跟 .pptx / .potx 文件相关的活。这个 skill 特别强调**设计感**和**视觉 QA**：不做白底 + 子弹点的无聊 PPT。深入路径见 editing.md（编辑模板）和 pptxgenjs.md（从零生成）。"
---

# Skill: pptx（幻灯片全能工具箱）

**参考来源**：Anthropic 官方 pptx skill，本项目中文化 + 去 XSD schema（1MB 太重）+ 适配本项目 supervisor 单 agent 架构（视觉 QA 由主 agent 自审，非子代理）。

## skill 目录布局

- `SKILL.md`（本文档）—— 主入口 + 设计准则 + QA 强制流程
- `editing.md` —— 基于模板编辑现有 pptx 的完整流程，改模板时 `read_file <skill_path>/editing.md`
- `pptxgenjs.md` —— pptxgenjs Node 库详细教程，从零画时 `read_file <skill_path>/pptxgenjs.md`
- `scripts/` —— 预置脚本，用 `uv run <scripts_path>/xxx.py` 调用
- **不要**修改本目录里的脚本，要定制先 `cp` 到 `workspace/scripts/` 再改

## Quick Reference（任务 → 路径）

| 任务 | 首选路径 | 备注 |
|---|---|---|
| **读 pptx 内容**（提文字） | agent 已有的 `extract_document_text` 工具 | 不走本 skill |
| **模板缩略图预览**（看有哪些 layout） | `uv run <scripts_path>/thumbnail.py template.pptx` | Pillow 拼图 |
| **基于模板做 PPT** | 见 `editing.md` | unpack → 改 XML → clean → pack |
| **从零画 PPT** | 见 `pptxgenjs.md` | pptxgenjs Node 库 |
| **pptx → PDF** | `uv run <scripts_path>/office/soffice.py --headless --convert-to pdf a.pptx` | LibreOffice |
| **pptx → 图片**（QA 用） | pptx → pdf 再 `pdftoppm -jpeg -r 150 a.pdf slide` | poppler |
| **.ppt → .pptx**（老格式升级） | `soffice --headless --convert-to pptx a.ppt` | LibreOffice |
| **合并 / 拆分幻灯片** | `add_slide.py` + 编辑 `<p:sldIdLst>` | 见 editing.md |
| **清理编辑后的残留** | `uv run <scripts_path>/clean.py unpacked/` | pack 前必跑 |

---

## 决定走哪条路径

第一件事：**判断用户手上有没有可参考的模板 / 现有 pptx**。

- **有** → 走 editing.md 的模板路径（复用样式，保真度最高）
- **没有** → 走 pptxgenjs.md 的从零路径

千万不要在有模板的情况下还硬走 pptxgenjs 从零画 —— 用户模板里的字体、配色、母版都是经过设计的，从零画大概率不如模板漂亮。

---

## 设计准则（本 skill 的灵魂）

**不要做无聊的 PPT**。白底 + 一行标题 + 三行子弹点，是最容易被人合上笔电的组合。每一页都值得多想 30 秒的视觉安排。

### 动手前先定基调

- **配色要跟主题相关**：讲金融就深蓝深金、讲环保就森林绿、讲医疗就柔和青绿。**不要默认蓝色**——蓝色是 PPT 的"米饭"，永远不出错但也永远不出彩。把你选的色号换到一个完全无关的 PPT 里如果"也能用"，那说明选得不够专属。
- **主色支配**：一个颜色占 60-70% 视觉重量，1-2 个辅色，一个尖锐的强调色。别搞平均主义，PPT 不是配色练习。
- **深浅对比结构**：标题页和结尾页深底，中间内容页浅底，形成"深-浅-深"的三明治。或者从头深底到底做高级感。
- **确定一个视觉母题**：圆角图框、彩色圆里的图标、大号数字……选一个贯穿全套。**不要把彩色装饰条 / 边条当母题**（详见 Avoid 列表）。

### 参考色板（10 套主题化）

拿来即用或作为二次配色的起点。所有色号都是 6 位 hex（不带 `#`），可直接塞进 pptxgenjs 的 `color` 字段或 pptx XML 的 `<a:srgbClr val="…"/>`。

| 主题名 | 主色 | 辅色 | 强调 |
|---|---|---|---|
| **午夜执行**（Midnight Executive） | `1E2761`（海军蓝） | `CADCFC`（冰蓝） | `FFFFFF`（白） |
| **森林与苔藓**（Forest & Moss） | `2C5F2D`（森林绿） | `97BC62`（苔藓） | `F5F5F5`（奶白） |
| **珊瑚能量**（Coral Energy） | `F96167`（珊瑚红） | `F9E795`（暖金） | `2F3C7E`（海军蓝） |
| **暖赤陶**（Warm Terracotta） | `B85042`（赤陶） | `E7E8D1`（沙色） | `A7BEAE`（鼠尾草） |
| **海洋渐层**（Ocean Gradient） | `065A82`（深蓝） | `1C7293`（青绿） | `21295C`（午夜） |
| **炭色极简**（Charcoal Minimal） | `36454F`（炭灰） | `F2F2F2`（近白） | `212121`（黑） |
| **青绿信任**（Teal Trust） | `028090`（青绿） | `00A896`（海泡） | `02C39A`（薄荷） |
| **莓果与奶油**（Berry & Cream） | `6D2E46`（莓果） | `A26769`（尘玫瑰） | `ECE2D0`（奶白） |
| **鼠尾草平静**（Sage Calm） | `84B59F`（鼠尾草） | `69A297`（桉树） | `50808E`（石板灰） |
| **樱桃大胆**（Cherry Bold） | `990011`（樱桃） | `FCF6F5`（近白） | `2F3C7E`（海军蓝） |

用户品牌色优先。用户没给色但主题明确时，从上表挑一个匹配氛围的，别默认蓝色。

### 每一页都要有视觉元素

**纯文字页面会被遗忘**。至少放一张图 / 一个图表 / 一组图标 / 一个大色块。

**常见布局套路**（挑一个，别每页都一样）：

- 两栏：左文右图 / 左图右文
- 图标行：彩色圆里的图标 + 加粗标题 + 描述文字
- 2x2 或 2x3 网格：一侧一张大图，另一侧内容格
- 半出血图：图片占左半或右半整个高度，文字叠在另一半
- 大数字页：60-72pt 的关键数字 + 小号说明标签
- 对比页：并列两列（before/after、方案 A/B）
- 时间线：编号步骤 + 箭头

### 字体（这段很技术，仔细看）

**核心事实**：你写进 pptx 的字体名，是**用户电脑上的 PowerPoint 渲染的**，跟本项目环境无关。视觉 QA 走 LibreOffice → PDF → 图片这条路，LibreOffice 会替换缺失字体，**替换字的字宽跟原字未必一致**——QA 图上看着不溢出，用户打开可能就溢出了。

所以字体分两档：

**"QA 可信 + Office 自带"**（正文和"必须不能溢出"的场景优先用这些）：

- Arial、Calibri、Cambria、Times New Roman、Courier New、Bookman Old Style、Century Schoolbook

**"QA 不可信"**（LibreOffice 替换字宽跟原字不同，QA 图上的"没溢出"未必真的没溢出）：

- Georgia、Trebuchet MS、Impact、Arial Black、Garamond、Consolas、Palatino Linotype、Calibri Light

用户点名要 QA 不可信的字体：只在标题 / 强调元素上用，容器给约 10% 的额外余量，别信 QA 图上的"刚好塞下"。

**永远不要用 Aptos**：Office 2023+ 的新默认字体，QA 环境和老 Office 都可能没有，两头都不靠谱。

**中文字体建议**：

- 正文优先 **微软雅黑**、**苹方 SC**（现代无衬线，跨平台好）
- 标题可以配 **思源宋体**、**华文中宋**（有质感）
- **不要**用**华文行楷**、**幼圆**等装饰性字体做正文
- 中文场景要意识到：Windows 用户看到的字体跟 macOS 用户可能不同，重要文档留字体余量

**字号建议**：

| 元素 | 字号 |
|---|---|
| 幻灯片标题 | 36-44pt 加粗 |
| 章节头 | 20-24pt 加粗 |
| 正文 | 14-16pt |
| 脚注 / 说明 | 10-12pt 灰色 |

### 间距

- 最小 0.5 英寸（约 12mm）页边距
- 内容块之间 0.3-0.5 英寸间隔
- 留白，别把每一寸都塞满

### Avoid（红线合集）

- **不要每页都用同一个 layout** —— 变化列数、卡片、大数字，同一个套路重复 10 遍等于催眠
- **不要正文居中** —— 只有标题居中，段落和列表左对齐
- **字号对比要够** —— 标题 36pt+ 才能压住 14-16pt 正文
- **不要默认蓝色** —— 挑跟主题相关的颜色
- **不要一页精心其余摆烂** —— 要么全做要么全简
- **不要纯文字页** —— 加图 / 图标 / 图表 / 色块
- **文本框内边距记得处理** —— 文字要跟旁边形状对齐时，设 `margin: 0`
- **绝对不要在标题下加装饰性下划线** —— **AI 生成 PPT 的标志性特征**，用留白或背景色分隔
- **绝对不要加彩色装饰条 / 边条** —— 页头页脚长条、侧边条、卡片单边细条都算，**AI 生成的填充物**特征。想让卡片显眼用淡背景色或阴影，不要用边条
- **不要默认米色 / 奶白色背景** —— `F5F5DC`、`FAF0E6`、`FAEBD7`、`FFF8E1` 这些暖中性色是 AI 默认审美，用白色 `FFFFFF` 或用户品牌色
- **不要放文本溢出容器** —— 塞不下就缩字号 / 分页 / 加大容器，别让内容被切
- **不要低对比度** —— 浅底浅字 / 深底深字 / 深底深图标都不行

---

## QA（强制流程，两轮内收敛）

第一次生成必然有真实问题（重叠 / 溢出 / 对齐错位）。找到并修，然后停。**别陷入无限调像素**。

### 内容 QA

```
uv run <workspace or absolute path>/extract 一下（或让 agent 直接用 extract_document_text 工具）
```

检查错字、漏内容、顺序错乱。**用模板时，特别 grep 找占位符残留**：

```
extract_document_text output.pptx 后在返回内容里搜：xxx / lorem / ipsum / TODO / [insert / this.*page layout / this.*slide layout
```

有命中就修完再交付。

### 视觉 QA（**强制走完这一步**）

**为什么必须走**：你写 XML / 写 pptxgenjs 代码时会"看到自己期望的样子"而不是实际的样子。转成图片再抽一遍文字，是最有效的自查。

**本项目做法（主 agent 自审）**：**当前模型不支持多模态**，无法直接"看图"，所以视觉 QA 走 OCR 侧写这条路：

1. 把 pptx 转成一页一张 jpg（转图流程见下节）
2. 主 agent 用 `extract_document_text` **依次读每张 `.qa/slide-N.jpg`**（tesseract OCR 抽出图片里的文字）
3. 每读完一张，按下方 **OCR 能查的清单** 检查

**OCR 视觉审查清单**（当前模型能查的）：

- **文字被切 / 不完整** —— OCR 出的文字断在奇怪位置、句子没写完，说明容器塞不下溢出被 pdftoppm 裁掉了
- **占位符残留** —— OCR 里出现 `xxx` / `lorem` / `ipsum` / `TODO` / `[insert` / `this.*page layout`（前面 grep 没抓到的兜底）
- **文字顺序错乱** —— 应该是"标题 → 段落 → 子弹"的页，OCR 出来顺序倒了（暗示布局重排了）
- **每页字数是否合理** —— 有的页 OCR 出来几乎没字（意外空页 / 装饰盖住内容），或者字爆炸多（塞太满）

**当前模型查不了的**（纯视觉问题，OCR 拿不到）：

- 元素重叠（文字压过形状 / 线穿过字）
- 距页边缘不足 / 多栏对齐
- 低对比度文字 / 图标
- 模板装饰错位（标题下划线错位）
- 颜色 / 配色问题

**这些视觉问题只能靠用户自己看**——在交付时明确告诉用户："OCR 能查的都过了，纯视觉的（重叠 / 对齐 / 配色）需要你自己开一下确认"。

未来切多模态模型时，把工具换回 `read_file` + 打开完整清单就行。

### 修复循环

1. 生成 → 转图 → 逐页 OCR → 列出 OCR 能查到的缺陷
2. **优先修文字被切 / 占位符** —— 这两个用户开 PPT 一眼就会看到
3. 修
4. **只重新验证受影响的页**
5. **修一次 - 验证一次就停** —— 一轮 OCR 后如果只剩纯视觉判断不了的问题，交付给用户自查，别死磕

---

## 转图流程（QA 必走）

**产物一律放 workspace 的 `.qa/` 子目录**，别污染 workspace 根 —— 用户会被 slide-*.jpg + 中间 PDF 淹没。前端对 `.` 开头的目录默认折叠，用户看到的 workspace 依然干净，需要复看时点开就是。

```
mkdir -p .qa
uv run <scripts_path>/office/soffice.py --headless --convert-to pdf output.pptx --outdir .qa
rm -f .qa/slide-*.jpg
pdftoppm -jpeg -r 150 .qa/output.pdf .qa/slide
ls -1 "$PWD"/.qa/slide-*.jpg
```

**注意事项**：

- `--outdir .qa` 让 soffice 把 PDF 直接落到 `.qa/`（省一步 mv）
- `-r 150` DPI 够看，太大 jpg 会飙升
- `pdftoppm` 会 zero-pad 页码到总页数宽度：`< 10` 页产 `slide-1.jpg`，`10-99` 页产 `slide-01.jpg`，`100+` 产 `slide-001.jpg`。**用 `ls` 拿真实文件名，别硬拼**
- `rm -f .qa/slide-*.jpg` 清掉上一轮残留，不然新旧混在一起会读到旧图
- **改完 pptx 后必须重新走这五步** —— PDF 要重新生成，pdftoppm 才能反映改动
- 交付时告诉用户"QA 图放在 `.qa/`，前端默认折叠，需要看点开就是"

**首次运行 LibreOffice headless 会创建 user profile，可能慢 3-5 秒**，第二次就快。

---

## 依赖

**必需**：
- **LibreOffice**：`brew install --cask libreoffice`（转 PDF / 转图 / 老 .ppt 升级都靠它）
- **Node.js + pptxgenjs**：`brew install node && npm install -g pptxgenjs`（从零画 pptx 必需，编辑现有 pptx 不需要）

**推荐**（pdf skill 已要求过）：
- **Poppler**：`brew install poppler`（`pdftoppm` 转图）
- **uv**：跑 Python 脚本

**Python 依赖**（走 PEP 723 声明在脚本头部，`uv run` 自动装）：
- `Pillow`（`thumbnail.py` 用）
- `defusedxml`（`unpack.py` / `pack.py` 用）
- `lxml`（`validate.py` 用）

**用户没装 LibreOffice 时**：告诉用户装，不要瞎兜底。pptx 的核心操作（转 PDF、转图、老格式升级）都强依赖 LibreOffice，没有替代品。

---

## Never（红线）

- **Never** 用 python-pptx 自己实现从零画 —— 我们走 pptxgenjs（有 Claude 官方踩坑经验的完整教程）
- **Never** 手动改本 skill 目录里的脚本 —— `cp` 到 workspace 再改
- **Never** 生成完没跑视觉 QA 就告诉用户"做好了"
- **Never** 无限循环调像素 —— 修一次 - 验证一次就停
- **Never** 默认蓝色 / 米色 / 白底子弹点这种 AI 特征组合
- **Never** 在标题下加装饰性下划线，或在页 / 卡片一侧加彩色装饰条
- **Never** 从零画时不 `rezip.py` —— pptxgenjs 输出未压缩，文件会虚胖 3-5 倍
- **Never** 编辑现有 pptx 时手动 `cp` slide 文件 —— 用 `add_slide.py`，它会处理 Content_Types / 关系 ID / notes 引用

---

## 自检 SOP

生成 / 编辑完必跑：

```
ls -lh <output.pptx> && file <output.pptx>
```

- 大小合理（几十 KB 到几 MB，看图片量。< 5KB 是空文件）
- `file` 应看到 `Microsoft PowerPoint 2007+` 或 `Zip archive data`

然后**必跑视觉 QA**（见上节），别跳过。

编辑现有 pptx 时额外跑：

```
uv run <scripts_path>/office/validate.py output.pptx --auto-repair -v
```

会跑结构校验（XML 合法 / 命名空间 / ID 唯一 / 关系 / Content Types / slide layout / 备注引用 / 重复 layout），发现修得了的自动修（空白保留等）。

---

## 交付时给用户看的内容

- 产物**绝对路径** + 大小 + 页数（用 `pdfinfo` 或 `soffice` 转完 PDF 看）
- 用了哪条路径：**pptxgenjs 从零** / **模板编辑** / **格式转换**
- 用了哪套色板（如"用了午夜执行配色，主色 #1E2761"）
- 走了几轮 QA、修了什么缺陷
- 可调建议：字号 / 配色替换 / layout 调整 —— 让用户能进一步微调

---

## 超出本 skill 范围的请求

- **动画 / 转场特效** —— pptxgenjs 不支持动画（PowerPoint 独有的时间线 XML 太复杂），告诉用户在 PowerPoint 里手动加
- **嵌入视频 / 音频** —— 不支持，告诉用户导出后手动嵌入
- **精细的母版 / 主题（.thotx）设计** —— 让用户在 PowerPoint 里做母版，本 skill 复用现成的 .potx

这条边界跟用户说清楚，别硬撑着上超出范围的工作流。
