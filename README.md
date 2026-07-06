# Mermaid2PowerPoint

**[中文](#中文) | [English](#english)**

---

## 中文

将 Mermaid 图转换成可编辑的 PowerPoint `.pptx`。

导出结果使用 PowerPoint 原生 shape、text 和 geometry，不是整张截图。  
项目同时提供网页、CLI 和 Node API。

### 支持范围

- `flowchart` / `graph`、`sequenceDiagram`、`stateDiagram-v2`、`mindmap`、`erDiagram`、`gantt`、`classDiagram`
- 常见流程图节点：矩形、圆角矩形、圆/椭圆、菱形、六边形、输入输出、子程序、数据库、手工输入、手工操作、文档、显示、内部存储
- `subgraph` / `cluster` 容器和标题
- Mermaid 图片节点 `@{ img: ... }`
- `foreignObject`、普通 SVG `<text>`、`<tspan>` 多行文本
- sequenceDiagram 的 `actor` / `participant` 参与者头部符号
- sequenceDiagram 的正向 / 反向消息箭头方向
- `classDef` 节点填充色、边框色、字号和文本色
- `linkStyle` 线条颜色、粗细、虚线
- edge label 背景框、彩色边框和主题色文本
- 默认 edge label 不加 themed 边框（与 Mermaid 预览一致），并关闭自动换行避免窄标签被误断行
- 节点文字直接写入形状（PPT 里移动节点形状时文字一起移动），常规形状节点（矩形、圆角矩形、椭圆、菱形、六边形、flowChart 预设等）均已支持
- sequenceDiagram 的 Note 背景框与文字合并为单个可编辑对象
- sequence note 的 `<br/>` 多行文本合并导出
- sequence `actor` 火柴人符号会合并为单个可编辑 geometry
- state note、多层 state cluster、起止状态节点
- class / object 风格关系的三角、菱形、圆点等常见连接符号
- ER cardinality、类图/对象图 marker 的条线、菱形、圆点和 crow-foot 装饰图形
- 直线、折线和常见三次/二次曲线路径
- mindmap / ER / gantt / sequence / state / class 的通用 SVG primitive 映射
- 导出为原生 PowerPoint geometry，不嵌入图片

处理流程：

1. 先把 Mermaid 渲染成 SVG，拿到 Mermaid 已经计算好的布局坐标。
2. 解析 SVG 中的节点、文本、样式和边线路径。
3. 用 `pptxgenjs` 在 PPT 里重建原生 shape、text 和曲线路径。

### 限制

- `flowchart` 仍然是语义化映射最完整的一类图
- `sequenceDiagram`、`stateDiagram-v2`、`mindmap`、`erDiagram`、`gantt`、`classDiagram` 已支持，但部分结构仍通过通用 SVG primitive 重建，而不是更高层语义对象
- 常见流程图节点已经尽量映射到 PowerPoint 原生预设形状，少数不规则轮廓仍保留为自定义 geometry
- customGeometry 节点（如 stadium、subroutine、cylinder 等自定义路径形状）的文字仍作为独立文本框，移动形状时文字不会跟随（pptxgenjs 的 `addText` 不支持自定义几何 `points`）
- ER crow-foot 已导出为可编辑装饰图形，但和浏览器 SVG 仍不是逐像素完全一致
- 复杂图标节点、泳道、部分特殊 marker 和更多高级 shape 还没有完整覆盖
- 对极少数 SVG `path` 指令仍会保守降级，目标是保持可编辑和结构正确
- 不是逐像素复刻 SVG，重点是“PPT 可编辑”而不是“SVG 100% 像素级一致”

### 项目结构

- `src/parseSvg.ts`: Mermaid SVG 解析器
- `src/svgPath.ts`: SVG path 命令解析和几何边界计算
- `src/pptx.ts`: SVG 坐标到 PptxGenJS 原生 shape 的映射（含节点文字合并进形状、边标签无边框等逻辑）
- `src/mermaidCliRenderer.ts`: 调用 `mmdc` 把 `.mmd` 渲染成 SVG
- `src/server.ts`: 静态网页服务
- `src/cli.ts`: 命令行入口
- `src/test/`: 解析、导出、端到端和 Web API 回归测试
- `examples/`: 常见 Mermaid 示例和回归 fixture
- `web/`: 网页编辑器、预览界面和下载前端（含深浅色主题、中英切换、节点文字合并进形状、边标签无边框等导出优化）
- `scripts/build-pages.mjs`: 生成 GitHub Pages 静态站点产物

### 安装

推荐使用 Node.js 22。

```bash
npm install
```

仓库已经把 `@mermaid-js/mermaid-cli` 放进 `devDependencies`，普通 `npm install` 就会一起装好。

### 用法

#### 1. 启动网页

```bash
npm run dev
```

打开：

```text
http://127.0.0.1:3000
```

网页支持：

- Mermaid 输入编辑
- 实时语法检查
- 浏览器内 SVG 预览
- 浏览器内直接生成可编辑 PPT 并下载
- 深色 / 浅色主题切换（跟随系统偏好，可手动切换并记忆）
- 中文 / 英文界面切换（记忆语言偏好）

生产运行方式：

```bash
npm run build
npm start
```

#### 2. 从 Mermaid 源文件直接转 PPT

```bash
npm run build
node dist/cli.js examples/shape-regression.mmd -o editable-flow.pptx --no-sandbox
```

#### 3. 从 SVG 直接转 PPT

```bash
npm run build
node dist/cli.js output.svg --input svg -o editable-output.pptx
```

常用参数：

- `--theme <name>`: Mermaid 主题
- `--background <color>`: Mermaid 背景色
- `--scale <number>`: Mermaid 渲染缩放
- `--padding <px>`: 幻灯片边距，单位是 SVG 像素
- `--mmdc-path <path>`: 显式指定 `mmdc`
- `--puppeteer-config <path>`: 传给 Mermaid CLI 的 Puppeteer 配置文件
- `--no-sandbox`: 给 Chromium 增加 `--no-sandbox --disable-setuid-sandbox`

代码里也会在检测到 Chromium sandbox 启动失败时自动重试一次 no-sandbox。

### 编程接口

### `convertSvgToPptx(svgString, outputPath)`

```ts
import { convertSvgToPptx } from "./dist/index.js";

const svg = `<svg viewBox="0 0 200 100">...</svg>`;
await convertSvgToPptx(svg, "diagram.pptx");
```

### `convertMermaidCodeToPptxBuffer(mermaidCode, options)`

```ts
import { convertMermaidCodeToPptxBuffer } from "./dist/index.js";

const buffer = await convertMermaidCodeToPptxBuffer("flowchart TD\nA-->B");
```

### 回归示例

仓库里带了几组回归 fixture：

- `examples/simple-flow.mmd`: 基础流程图
- `examples/shape-regression.mmd`: 圆角矩形、圆、六边形
- `examples/flowchart-special-shapes.mmd`: 输入输出、子程序、数据库、不对称节点
- `examples/flowchart-preset-nodes.mmd`: 手工输入、手工操作、文档、显示、内部存储
- `examples/styled-links.mmd`: `classDef`、彩色边框和 edge label
- `examples/curved-basis.mmd`: basis 曲线边
- `examples/cluster-regression.mmd`: subgraph / cluster
- `examples/image-node.mmd`: 图片节点
- `examples/sequence-basic.mmd`: 基础时序图
- `examples/sequence-direction-arrows.mmd`: 时序图正向 / 反向箭头
- `examples/sequence-note-breaks.mmd`: 时序图 note 多行文本
- `examples/state-basic.mmd`: 基础状态图
- `examples/mindmap-basic.mmd`: 基础脑图
- `examples/er-basic.mmd`: 基础 ER 图
- `examples/er-cardinality.mmd`: ER cardinality 关系端点
- `examples/gantt-basic.mmd`: 基础甘特图
- `examples/class-relations.mmd`: 类图 / 对象关系连接符号

### 测试

```bash
npm test
```

测试覆盖：

- Mermaid SVG 解析测试
- 节点形状和样式回归测试
- cluster / image node 回归测试
- sequence / state / mindmap / ER / gantt 回归测试
- 曲线路径和 edge label 回归测试
- SVG -> PPTX 原生 geometry 导出测试
- `.mmd -> .pptx` 端到端测试
- 网页静态服务和浏览器导出资源测试

### GitHub Pages

仓库已经带了 GitHub Pages 工作流：

- [.github/workflows/pages.yml](.github/workflows/pages.yml)

Pages 会发布静态网页编辑器，并直接支持浏览器内导出 PPT。

需要注意：

- 第一次使用自定义 Pages 工作流时，需要在仓库 `Settings -> Pages -> Source` 里选择 `GitHub Actions`
- Pages 上导出逻辑现在完全在浏览器里执行，不依赖 Node 后端
- 图片节点若引用跨域资源，浏览器仍可能因为 CORS 无法把图片嵌入 PPT

如果你想让 CI 自动帮你启用 Pages，可以额外创建一个 `PAGES_ENABLEMENT_TOKEN` secret。这个 token 需要有足够的仓库和 Pages 管理权限。

预构建 Pages 产物：

```bash
npm run pages:build
```

### 验证
- `npm run check`
- `npm test`
- `npm run pages:build`

生成的 PPTX 中没有 `<p:pic>` 图片对象，只有 PowerPoint 的原生 shape、text 和自定义 geometry 节点。

### GitHub CI

仓库包含：

- [.github/workflows/ci.yml](.github/workflows/ci.yml)
- [.github/workflows/pages.yml](.github/workflows/pages.yml)

推到 GitHub 后：

- `CI` 会自动执行 `npm ci` 和 `npm test`
- `Pages` 会在主分支推送后发布静态网页

---

## English

Convert Mermaid diagrams into editable PowerPoint `.pptx`.

The export uses native PowerPoint shapes, text and geometry — not a single screenshot.  
The project ships a web app, a CLI and a Node API.

### Supported Features

- `flowchart` / `graph`, `sequenceDiagram`, `stateDiagram-v2`, `mindmap`, `erDiagram`, `gantt`, `classDiagram`
- Common flowchart nodes: rectangle, rounded rectangle, circle/ellipse, diamond, hexagon, input/output, subroutine, database, manual input, manual operation, document, display, internal storage
- `subgraph` / `cluster` containers and titles
- Mermaid image nodes `@{ img: ... }`
- `foreignObject`, plain SVG `<text>`, `<tspan>` multi-line text
- sequenceDiagram `actor` / `participant` header symbols
- sequenceDiagram forward / reverse message arrow directions
- `classDef` node fill, border, font-size and text color
- `linkStyle` line color, width, dash style
- Edge label background, colored border and themed text
- Default edge labels omit the themed border (matching the Mermaid preview) and disable auto-wrapping to avoid narrow labels breaking incorrectly
- Node text is written directly into the shape (moving a node shape in PowerPoint moves the text with it); regular shape nodes (rectangle, rounded rectangle, ellipse, diamond, hexagon, flowChart presets, etc.) are all supported
- sequenceDiagram Note background and text are merged into a single editable object
- sequence note `<br/>` multi-line text merging
- sequence `actor` stick figure is merged into a single editable geometry
- state note, multi-level state clusters, start/end state nodes
- class / object relationship triangles, diamonds, dots and other common connector symbols
- ER cardinality, class/object marker bars, diamonds, dots and crow-foot decoration shapes
- Straight, polyline and common cubic/quadratic curve paths
- Generic SVG primitive mapping for mindmap / ER / gantt / sequence / state / class
- Exports native PowerPoint geometry, no embedded images

How it works:

1. Render Mermaid to SVG to reuse Mermaid's computed layout coordinates.
2. Parse nodes, text, styles and edge paths from the SVG.
3. Rebuild native shapes, text and curve paths in PowerPoint via `pptxgenjs`.

### Limitations

- `flowchart` remains the most completely mapped diagram type
- `sequenceDiagram`, `stateDiagram-v2`, `mindmap`, `erDiagram`, `gantt`, `classDiagram` are supported, but some structures are still rebuilt via generic SVG primitives rather than higher-level semantic objects
- Common flowchart nodes are mapped to native PowerPoint preset shapes where possible; a few irregular outlines remain as custom geometry
- customGeometry nodes (e.g. stadium, subroutine, cylinder and other custom-path shapes) still keep their text as a separate text box — moving the shape does not move the text (pptxgenjs `addText` does not support custom geometry `points`)
- ER crow-foot is exported as editable decoration shapes, but is not pixel-perfect identical to the browser SVG
- Complex icon nodes, swimlanes, some special markers and more advanced shapes are not yet fully covered
- A few rare SVG `path` commands degrade conservatively to keep the result editable and structurally correct
- This is not a pixel-perfect SVG replica — the focus is "editable in PowerPoint" rather than "100% pixel-identical to SVG"

### Project Structure

- `src/parseSvg.ts`: Mermaid SVG parser
- `src/svgPath.ts`: SVG path command parsing and geometry bounds
- `src/pptx.ts`: SVG coordinate to PptxGenJS native shape mapping (includes node-text-into-shape merging, borderless edge labels, etc.)
- `src/mermaidCliRenderer.ts`: invokes `mmdc` to render `.mmd` into SVG
- `src/server.ts`: static web server
- `src/cli.ts`: CLI entry point
- `src/test/`: parsing, export, end-to-end and web API regression tests
- `examples/`: common Mermaid samples and regression fixtures
- `web/`: web editor, preview UI and download frontend (includes light/dark theme, ZH/EN toggle, node-text-into-shape merging, borderless edge labels and other export improvements)
- `scripts/build-pages.mjs`: builds the GitHub Pages static site

### Install

Node.js 22 is recommended.

```bash
npm install
```

`@mermaid-js/mermaid-cli` is already in `devDependencies`, so a plain `npm install` pulls it in.

### Usage

#### 1. Start the web app

```bash
npm run dev
```

Open http://127.0.0.1:3000

The web app supports:

- Mermaid input editing
- Real-time syntax checking
- In-browser SVG preview
- In-browser editable PPT generation and download
- Dark / light theme toggle (follows system preference, manually switchable and remembered)
- Chinese / English UI toggle (remembers language preference)

Production:

```bash
npm run build
npm start
```

#### 2. Convert a Mermaid source file to PPT

```bash
npm run build
node dist/cli.js examples/shape-regression.mmd -o editable-flow.pptx --no-sandbox
```

#### 3. Convert an SVG to PPT

```bash
npm run build
node dist/cli.js output.svg --input svg -o editable-output.pptx
```

Common flags:

- `--theme <name>`: Mermaid theme
- `--background <color>`: Mermaid background color
- `--scale <number>`: Mermaid render scale
- `--padding <px>`: slide padding in SVG pixels
- `--mmdc-path <path>`: explicit `mmdc` path
- `--puppeteer-config <path>`: Puppeteer config file passed to Mermaid CLI
- `--no-sandbox`: adds `--no-sandbox --disable-setuid-sandbox` to Chromium

The code also auto-retries once with no-sandbox when a Chromium sandbox launch failure is detected.

### Programmatic API

#### `convertSvgToPptx(svgString, outputPath)`

```ts
import { convertSvgToPptx } from "./dist/index.js";

const svg = `<svg viewBox="0 0 200 100">...</svg>`;
await convertSvgToPptx(svg, "diagram.pptx");
```

#### `convertMermaidCodeToPptxBuffer(mermaidCode, options)`

```ts
import { convertMermaidCodeToPptxBuffer } from "./dist/index.js";

const buffer = await convertMermaidCodeToPptxBuffer("flowchart TD\nA-->B");
```

### Regression Fixtures

The repo ships several regression fixtures:

- `examples/simple-flow.mmd`: basic flowchart
- `examples/shape-regression.mmd`: rounded rectangle, circle, hexagon
- `examples/flowchart-special-shapes.mmd`: input/output, subroutine, database, asymmetric node
- `examples/flowchart-preset-nodes.mmd`: manual input, manual operation, document, display, internal storage
- `examples/styled-links.mmd`: `classDef`, colored borders and edge labels
- `examples/curved-basis.mmd`: basis curve edges
- `examples/cluster-regression.mmd`: subgraph / cluster
- `examples/image-node.mmd`: image node
- `examples/sequence-basic.mmd`: basic sequence diagram
- `examples/sequence-direction-arrows.mmd`: sequence forward / reverse arrows
- `examples/sequence-note-breaks.mmd`: sequence note multi-line text
- `examples/state-basic.mmd`: basic state diagram
- `examples/mindmap-basic.mmd`: basic mindmap
- `examples/er-basic.mmd`: basic ER diagram
- `examples/er-cardinality.mmd`: ER cardinality endpoints
- `examples/gantt-basic.mmd`: basic gantt chart
- `examples/class-relations.mmd`: class / object relationship connectors

### Testing

```bash
npm test
```

Test coverage:

- Mermaid SVG parsing tests
- Node shape and style regression tests
- cluster / image node regression tests
- sequence / state / mindmap / ER / gantt regression tests
- Curve path and edge label regression tests
- SVG -> PPTX native geometry export tests
- `.mmd -> .pptx` end-to-end tests
- Web static server and browser export resource tests

### GitHub Pages

The repo includes a GitHub Pages workflow: [.github/workflows/pages.yml](.github/workflows/pages.yml)

Pages publishes the static web editor and supports in-browser PPT export directly.

Notes:

- On first use of the custom Pages workflow, select `GitHub Actions` under repo `Settings -> Pages -> Source`
- The Pages export logic runs entirely in the browser, with no Node backend dependency
- Image nodes referencing cross-origin resources may still fail to embed into the PPT due to CORS

To let CI auto-enable Pages, create a `PAGES_ENABLEMENT_TOKEN` secret with sufficient repo and Pages admin permissions.

Pre-build the Pages artifact:

```bash
npm run pages:build
```

### Verification

- `npm run check`
- `npm test`
- `npm run pages:build`

The generated PPTX contains no `<p:pic>` image objects — only native PowerPoint shapes, text and custom geometry nodes.

### GitHub CI

The repo includes:

- [.github/workflows/ci.yml](.github/workflows/ci.yml)
- [.github/workflows/pages.yml](.github/workflows/pages.yml)

On push to GitHub:

- `CI` runs `npm ci` and `npm test`
- `Pages` publishes the static web app on pushes to the default branch
