# pptxgenjs —— 从零创建 PPT

**读到本文的前提**：用户没有可参考的模板，你要从零画一份 pptx。走 Node 库 [pptxgenjs](https://gitbrent.github.io/PptxGenJS/)。

有模板走 `editing.md`，不要用 pptxgenjs 从零画（复用模板样式保真度高得多）。

---

## 环境准备

### 一次装、到处用（推荐）

```
npm install -g pptxgenjs
```

**关键**：Node 的 `require()` **默认不查全局 node_modules**。所以跑脚本时必须**设 `NODE_PATH`** 让 require 找得到全局包：

```
NODE_PATH=$(npm root -g) node build_deck.js
```

这一条命令是**唯一正确的调用方式**，一次全局装完，任何 workspace 都能跑。

### 千万别做的事（走弯路的典型 pattern）

- ❌ **不要**试 `node -e "require('pptxgenjs')"` 探环境 —— 默认查不到，看到 fail 是正常的，别以为是没装
- ❌ **不要**直接 `node build_deck.js`（不带 NODE_PATH） —— 会 `Cannot find module 'pptxgenjs'`
- ❌ **不要**每个 workspace 都 `npm install pptxgenjs` —— 慢 + 每次 30MB 磁盘

### 已经装过就别再装

先跑 `npm ls -g pptxgenjs 2>&1 | head -3`。看到版本号就说明装了，直接 NODE_PATH 走。看到 empty 才 `npm install -g pptxgenjs`。

### 建议开发路径

写一个 `workspace/build_deck.js`，跑 `NODE_PATH=$(npm root -g) node build_deck.js` 生成 pptx。别把整套 JS 塞进 run_command 一行执行 —— 出错难查。

---

## 最小骨架

```javascript
const pptxgen = require("pptxgenjs");

let pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.author = "Interview-Agent";
pres.title = "标题";

let slide = pres.addSlide();
slide.addText("Hello", { x: 0.5, y: 0.5, fontSize: 36, color: "363636" });

pres.writeFile({ fileName: "output.pptx" }).then(() => console.log("done"));
```

**关键**：`writeFile` 是 Promise。node 脚本必须**等它 resolve**（用 `.then` 或 `await`），不然 pptx 可能没写完就退出。

## 【必跑】rezip 收尾

**pptxgenjs 写出的 pptx 是未压缩的 ZIP + 一堆空目录 stub**，文件会虚胖 3-5 倍。它自己的 `compression: true` 选项**没有效果**。

`writeFile` 完成后**必须**跑：

```
uv run <scripts_path>/rezip.py output.pptx
```

**Never** 不跑 rezip —— 交付前跑一遍，几十 KB 的东西可能会从 800KB 变回 150KB。

---

## 尺寸单位

坐标全部是**英寸**（不是像素、不是 pt）。

| Layout 名 | 宽 × 高（英寸） |
|---|---|
| `LAYOUT_16x9`（默认） | 10 × 5.625 |
| `LAYOUT_16x10` | 10 × 6.25 |
| `LAYOUT_4x3` | 10 × 7.5 |
| `LAYOUT_WIDE` | 13.3 × 7.5 |

排 slide 时脑子里换算这个矩形。0.5 英寸约 12mm，是"最小页边距"经验值。

---

## 文字

```javascript
slide.addText("简单文字", {
  x: 1, y: 1, w: 8, h: 2,
  fontSize: 24, fontFace: "微软雅黑",
  color: "363636", bold: true, align: "center", valign: "middle"
});
```

**要点**：

- `fontFace` 传字体名，直接写"微软雅黑"、"苹方 SC"、"Arial" —— 用户 PowerPoint 会用这个名字查字体（回到 SKILL.md 的字体安全表挑）
- `color` 是 6 位 hex，**不带 `#`**，也**不要** 8 位（透明度靠 `transparency` 字段单独指定）
- `align`: `"left"` / `"center"` / `"right"`；`valign`: `"top"` / `"middle"` / `"bottom"`

**字间距用 `charSpacing`，不是 `letterSpacing`**（后者会被静默忽略）：

```javascript
slide.addText("SPACED", { x: 1, y: 1, w: 8, h: 1, charSpacing: 6 });
```

**混合样式（同一段里加粗 + 斜体）**：传数组，每项一个 run：

```javascript
slide.addText([
  { text: "加粗 ", options: { bold: true } },
  { text: "斜体 ", options: { italic: true } },
  { text: "正文" }
], { x: 1, y: 3, w: 8, h: 1 });
```

**多行文字必须显式 `breakLine`**（不能用 `\n`）：

```javascript
slide.addText([
  { text: "第 1 行", options: { breakLine: true } },
  { text: "第 2 行", options: { breakLine: true } },
  { text: "第 3 行" }  // 最后一行不用 breakLine
], { x: 0.5, y: 0.5, w: 8, h: 2 });
```

**文本框有默认内边距**。要文字精确对齐旁边的形状 / 线 / 图标时，设 `margin: 0`。

---

## 列表 / 子弹

**正确**：走 `bullet` 选项，不要手动打 `•`。

```javascript
slide.addText([
  { text: "第一项", options: { bullet: true, breakLine: true } },
  { text: "第二项", options: { bullet: true, breakLine: true } },
  { text: "第三项", options: { bullet: true } }
], { x: 0.5, y: 0.5, w: 8, h: 3 });

// 编号列表
{ text: "第一步", options: { bullet: { type: "number" }, breakLine: true } }

// 子项目缩进
{ text: "子项", options: { bullet: true, indentLevel: 1 } }
```

**错误**：`slide.addText("• 第一项", ...)` —— PowerPoint 会渲染成**双子弹**（一个手打的加一个系统的）。

---

## 形状

```javascript
// 矩形
slide.addShape(pres.shapes.RECTANGLE, {
  x: 0.5, y: 0.8, w: 1.5, h: 3,
  fill: { color: "FF0000" },
  line: { color: "000000", width: 2 }
});

// 圆角矩形（rectRadius 只对 ROUNDED_RECTANGLE 生效，不能加在 RECTANGLE 上）
slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 1, y: 1, w: 3, h: 2,
  fill: { color: "FFFFFF" }, rectRadius: 0.1
});

// 椭圆
slide.addShape(pres.shapes.OVAL, { x: 4, y: 1, w: 2, h: 2, fill: { color: "0000FF" } });

// 线
slide.addShape(pres.shapes.LINE, {
  x: 1, y: 3, w: 5, h: 0,
  line: { color: "FF0000", width: 3, dashType: "dash" }
});

// 半透明
slide.addShape(pres.shapes.RECTANGLE, {
  x: 1, y: 1, w: 3, h: 2,
  fill: { color: "0088CC", transparency: 50 }
});

// 阴影
slide.addShape(pres.shapes.RECTANGLE, {
  x: 1, y: 1, w: 3, h: 2,
  fill: { color: "FFFFFF" },
  shadow: { type: "outer", color: "000000", blur: 6, offset: 2, angle: 45, opacity: 0.15 }
});
```

**⚠️ 绝对不要用形状造"装饰彩条 / 边条"**（页头页脚长条 / 侧边一列窄条 / 卡片单边装饰条）—— 这些是 AI 生成 PPT 的典型特征。想让卡片显眼，用**淡背景色**或**阴影**，别用边条。SKILL.md 的 Avoid 列表有完整说明。

**阴影参数注意**：

| 字段 | 类型 | 范围 | 备注 |
|---|---|---|---|
| `type` | 字符串 | `"outer"` / `"inner"` | |
| `color` | 字符串 | 6 位 hex（不带 `#`，不要 8 位 hex） | 透明度走 `opacity` |
| `blur` | 数字 | 0-100 pt | |
| `offset` | 数字 | 0-200 pt | **必须非负**——负值会破坏文件 |
| `angle` | 数字 | 0-359 度 | 阴影落下方向，顺时针从 3 点起（45 = 右下、135 = 左下、270 = 正上） |
| `opacity` | 数字 | 0.0-1.0 | |

要让阴影朝上（卡片贴在幻灯片底部时），**用 `angle: 270` + 正 `offset`，不要用负 offset**。

**没有原生渐变填充**。要渐变用一张渐变图当背景。

---

## 图片

**三种来源**：

```javascript
// 本地文件
slide.addImage({ path: "images/photo.jpg", x: 1, y: 1, w: 5, h: 3 });

// URL
slide.addImage({ path: "https://example.com/image.jpg", x: 1, y: 1, w: 5, h: 3 });

// base64（快，无文件 IO）
slide.addImage({ data: "image/png;base64,iVBORw0KGgo...", x: 1, y: 1, w: 5, h: 3 });
```

**选项**：

```javascript
slide.addImage({
  path: "image.png",
  x: 1, y: 1, w: 5, h: 3,
  rotate: 45,              // 0-359 度
  rounding: true,          // 圆形裁剪
  transparency: 50,        // 0-100
  flipH: true, flipV: false,
  altText: "图片描述",     // 无障碍
  hyperlink: { url: "https://example.com" }
});
```

**尺寸模式**：

```javascript
{ sizing: { type: "contain", w: 4, h: 3 } }        // 装进去，保持比例
{ sizing: { type: "cover",   w: 4, h: 3 } }        // 铺满，保持比例（可能裁）
{ sizing: { type: "crop", x: 0.5, y: 0.5, w: 2, h: 2 } }  // 裁指定区域
```

**保持比例的算法**：

```javascript
const origW = 1978, origH = 923, maxH = 3.0;
const calcW = maxH * (origW / origH);
const centerX = (10 - calcW) / 2;
slide.addImage({ path: "img.png", x: centerX, y: 1.2, w: calcW, h: maxH });
```

**支持格式**：PNG、JPG、GIF（Microsoft 365 支持动图）、SVG（现代 PowerPoint / M365）。

---

## 图标（推荐：react-icons + sharp 光栅化）

pptxgenjs 没有内置图标。**最省事的路径**：用 react-icons 生成 SVG → sharp 光栅化成 PNG → 走 base64 塞进 slide。全平台通吃。

**安装**：

```
npm install -g react-icons react react-dom sharp
```

**辅助函数**：

```javascript
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const sharp = require("sharp");
const { FaCheckCircle, FaChartLine } = require("react-icons/fa");

function renderIconSvg(IconComponent, color = "#000000", size = 256) {
  return ReactDOMServer.renderToStaticMarkup(
    React.createElement(IconComponent, { color, size: String(size) })
  );
}

async function iconToBase64Png(IconComponent, color, size = 256) {
  const svg = renderIconSvg(IconComponent, color, size);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return "image/png;base64," + png.toString("base64");
}
```

**塞进 slide**：

```javascript
const iconData = await iconToBase64Png(FaCheckCircle, "#4472C4", 256);
slide.addImage({ data: iconData, x: 1, y: 1, w: 0.5, h: 0.5 });  // 尺寸在 slide 上是英寸
```

**光栅化 size 建议 256 起步**——那是 SVG 转 PNG 的分辨率，跟 slide 上的显示尺寸（`w` / `h` 英寸）无关。分辨率太低图标会糊。

**常用图标集**：

- `react-icons/fa` —— Font Awesome
- `react-icons/md` —— Material Design
- `react-icons/hi` —— Heroicons
- `react-icons/bi` —— Bootstrap Icons
- 更多见 [react-icons.github.io](https://react-icons.github.io/react-icons/)

---

## 幻灯片背景

```javascript
// 纯色
slide.background = { color: "1E2761" };

// 图片背景（本地）
slide.background = { path: "bg.jpg" };

// 图片背景（base64）
slide.background = { data: "image/jpeg;base64,..." };
```

---

## 表格

```javascript
slide.addTable(
  [
    [{ text: "季度", options: { bold: true, fill: { color: "1E2761" }, color: "FFFFFF" } },
     { text: "营收", options: { bold: true, fill: { color: "1E2761" }, color: "FFFFFF" } }],
    ["Q1", "100"],
    ["Q2", "120"],
  ],
  {
    x: 0.5, y: 1, w: 9,
    colW: [3, 6],           // 每列宽度（英寸）
    rowH: 0.4,              // 行高
    fontSize: 14, fontFace: "微软雅黑",
    border: { pt: 1, color: "CCCCCC" },
  }
);
```

**cell 级样式**：数组元素传 `{ text, options }` 对象。option 支持 `fill` / `color` / `bold` / `align` / `valign` / `fontSize` / `colspan` / `rowspan`。

---

## 图表

```javascript
slide.addChart(pres.charts.BAR, [
  { name: "营收", labels: ["Q1", "Q2", "Q3", "Q4"], values: [100, 120, 135, 160] },
  { name: "利润", labels: ["Q1", "Q2", "Q3", "Q4"], values: [20, 25, 30, 40] },
], {
  x: 1, y: 1, w: 8, h: 4,
  chartColors: ["1E2761", "CADCFC"],
  showLegend: true, legendPos: "b",
});
```

**图表类型**（`pres.charts.XXX`）：`BAR`、`LINE`、`PIE`、`DOUGHNUT`、`AREA`、`SCATTER`、`RADAR`……

### 让图表好看点

- 用**主题色的 `chartColors`**，别默认 Office 蓝
- Y 轴标签字号 10-12pt，避免刻度线太密
- 图例位置 `"b"`（底部）比 `"r"`（右侧）更常用
- 单系列数据用**大数字 callout** 比图表更醒目
- 数据点少（≤ 5）时**别用饼图**，用横向条形图对比更清楚
- 折线图**至少 3 个数据点**才有趋势感

---

## 母版（Slide Masters）

多张 slide 复用统一背景 / logo / 页码 时用母版：

```javascript
pres.defineSlideMaster({
  title: "MAIN",
  background: { color: "FFFFFF" },
  objects: [
    { image: { x: 0.3, y: 0.3, w: 0.8, h: 0.3, path: "logo.png" } },
    { text: {
        text: "© 2026 公司名",
        options: { x: 0, y: 5.3, w: 10, h: 0.3, align: "center", fontSize: 10, color: "999999" }
    }},
  ],
  slideNumber: { x: 9.5, y: 5.3, w: 0.5, h: 0.3, fontSize: 10, color: "999999" },
});

let slide = pres.addSlide({ masterName: "MAIN" });
```

**用途**：多页 slide 需要一致的 logo、页脚、页码。写一次母版，addSlide 时传 `masterName` 即可。

---

## 演讲者备注

```javascript
slide.addNotes("这里讲这一页的要点：\n- 强调 X\n- 提问 Y");
```

用户在 PowerPoint 里打开会看到"备注"面板显示这段文字。适合放：讲稿、提问、时间提示。

---

## 常见坑

- **`writeFile` 是异步**：一定 `.then` 或 `await`，不然进程可能提前退出
- **必跑 rezip.py**：pptxgenjs 输出未压缩，文件虚胖
- **hex 颜色不带 `#`**，也不要 8 位 hex；透明度走 `transparency` / `opacity`
- **阴影 `offset` 必须非负**：负值会破坏文件；向上阴影用 `angle: 270 + 正 offset`
- **不要 `\n` 换行**：文字换行用 `breakLine: true` 或分开的 addText 调用
- **列表不要手打 `•`**：用 `bullet: true`
- **`rectRadius` 只对 `ROUNDED_RECTANGLE` 生效**，加在 `RECTANGLE` 上会静默无效
- **`charSpacing` 不是 `letterSpacing`**：后者会被静默忽略
- **图片路径要么绝对，要么相对 node 进程 cwd**：写 `slide.addImage({ path: "photo.jpg" })` 时确认脚本 `cwd` 就是图片所在目录
- **图标光栅化 size 别小于 256**：糊
- **别用不安全字体做正文**（Georgia / Impact / Aptos 等）—— 见 SKILL.md 字体安全表
- **中文字体**：`fontFace: "微软雅黑"` 或 `"苹方 SC"`；跨平台用 `"Microsoft YaHei"` 更保险（Windows/macOS 都有映射）

---

## Quick Reference（常用 API 索引）

| 你要干 | pptxgenjs API |
|---|---|
| 新建 pres | `new pptxgen()` |
| 设 layout | `pres.layout = "LAYOUT_16x9"` |
| 加 slide | `pres.addSlide()` |
| 加文字 | `slide.addText(text, opts)` |
| 加形状 | `slide.addShape(pres.shapes.XXX, opts)` |
| 加图片 | `slide.addImage({ path/data, ... })` |
| 加表格 | `slide.addTable(rows, opts)` |
| 加图表 | `slide.addChart(pres.charts.XXX, data, opts)` |
| 加母版 | `pres.defineSlideMaster({ title, ... })` |
| 加备注 | `slide.addNotes(text)` |
| 设背景 | `slide.background = { color / path / data }` |
| 写文件 | `pres.writeFile({ fileName })` → **必须** await / .then |

**收尾**：`writeFile` → `rezip.py` → 视觉 QA（回 SKILL.md）。

**遇冷门场景**：查 [pptxgenjs 官方文档](https://gitbrent.github.io/PptxGenJS/docs/quick-start/)，本文档只覆盖主线路径。
