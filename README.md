# Mermaid2PowerPoint

将 Mermaid flowchart 转成真正可编辑的 PowerPoint 原生 Shape，而不是图片。

网页里直接写 Mermaid，实时语法检查和预览，然后在浏览器里直接下载可编辑的 `.pptx`。

## 项目亮点

- 输出的是 PowerPoint 原生 shape、text 和 path，不是截图
- 支持网页、CLI、Node API 三种使用方式
- 支持实时 Mermaid 编辑、语法检查和 SVG 预览
- GitHub Pages 上也能直接在浏览器里导出 PPT
- 支持常见 Mermaid 节点形状、subgraph/cluster、图片节点
- 支持带主题色的 edge label、彩色边框和曲线路径
- 带回归测试、CI 和 GitHub Pages 发布

## 当前支持

- `flowchart` / `graph` 类 Mermaid 图
- 矩形、圆角矩形、圆/椭圆、菱形、六边形节点
- `subgraph` / `cluster` 容器和标题
- Mermaid 图片节点 `@{ img: ... }`
- `foreignObject` 和普通 SVG `<text>` 文本
- `classDef` 节点填充色、边框色、字号和文本色
- `linkStyle` 线条颜色、粗细、虚线
- edge label 背景框、彩色边框和主题色文本
- 直线、折线和常见三次/二次曲线路径
- 导出为原生 PowerPoint geometry，不嵌入图片

当前实现走的是一条稳定路线：

1. 先把 Mermaid 渲染成 SVG，拿到 Mermaid 已经计算好的布局坐标。
2. 解析 SVG 中的节点、文本、样式和边线路径。
3. 用 `pptxgenjs` 在 PPT 里重建原生 shape、text 和曲线路径。

## 当前限制

- 重点支持 `flowchart`，不保证时序图、脑图、er 图、甘特图等都能正确映射
- 复杂图标节点、泳道、部分特殊 marker 和更多高级 shape 还没有完整覆盖
- 对极少数 SVG `path` 指令仍会保守降级，目标是保持可编辑和结构正确
- 不是逐像素复刻 SVG，重点是“PPT 可编辑”而不是“SVG 100% 像素级一致”

## 项目结构

- `src/parseSvg.ts`: Mermaid SVG 解析器
- `src/svgPath.ts`: SVG path 命令解析和几何边界计算
- `src/pptx.ts`: SVG 坐标到 PptxGenJS 原生 shape 的映射
- `src/mermaidCliRenderer.ts`: 调用 `mmdc` 把 `.mmd` 渲染成 SVG
- `src/server.ts`: 本地静态网页服务
- `src/cli.ts`: 命令行入口
- `src/test/`: 解析、导出、端到端和 Web API 回归测试
- `examples/`: 常见 Mermaid 示例和回归 fixture
- `web/`: 网页编辑器、预览界面和下载前端
- `scripts/build-pages.mjs`: 生成 GitHub Pages 静态站点产物

## 安装

推荐使用 Node.js 22。

```bash
npm install
```

仓库已经把 `@mermaid-js/mermaid-cli` 放进 `devDependencies`，普通 `npm install` 就会一起装好。

## 用法

### 1. 启动网页

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

生产运行方式：

```bash
npm run build
npm start
```

### 2. 从 Mermaid 源文件直接转 PPT

```bash
npm run build
node dist/cli.js examples/shape-regression.mmd -o editable-flow.pptx --no-sandbox
```

### 3. 从 SVG 直接转 PPT

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

## 编程接口

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

## 回归示例

仓库里现在带了几组常见 Mermaid fixture：

- `examples/simple-flow.mmd`: 基础流程图
- `examples/shape-regression.mmd`: 圆角矩形、圆、六边形
- `examples/styled-links.mmd`: `classDef`、彩色边框和 edge label
- `examples/curved-basis.mmd`: basis 曲线边
- `examples/cluster-regression.mmd`: subgraph / cluster
- `examples/image-node.mmd`: 图片节点

## 测试

```bash
npm test
```

当前测试覆盖：

- Mermaid SVG 解析测试
- 节点形状和样式回归测试
- cluster / image node 回归测试
- 曲线路径和 edge label 回归测试
- SVG -> PPTX 原生 geometry 导出测试
- `.mmd -> .pptx` 端到端测试
- 网页静态服务和浏览器导出资源测试

## GitHub Pages

仓库已经带了 GitHub Pages 工作流：

- [.github/workflows/pages.yml](/home/david/Mermaid2PowerPoint/.github/workflows/pages.yml)

Pages 会发布静态网页编辑器，并直接支持浏览器内导出 PPT。

需要注意：

- 第一次使用自定义 Pages 工作流时，需要在仓库 `Settings -> Pages -> Source` 里选择 `GitHub Actions`
- Pages 上导出逻辑现在完全在浏览器里执行，不依赖 Node 后端
- 图片节点若引用跨域资源，浏览器仍可能因为 CORS 无法把图片嵌入 PPT

如果你想让 CI 自动帮你启用 Pages，可以额外创建一个 `PAGES_ENABLEMENT_TOKEN` secret。这个 token 需要有足够的仓库和 Pages 管理权限。

本地预构建 Pages 产物：

```bash
npm run pages:build
```

## 验证结果

当前版本已经本地验证：

- `npm run check`
- `npm test`
- `npm run pages:build`

生成的 PPTX 中没有 `<p:pic>` 图片对象，只有 PowerPoint 的原生 shape、text 和自定义 geometry 节点。

## GitHub CI

仓库包含：

- [.github/workflows/ci.yml](/home/david/Mermaid2PowerPoint/.github/workflows/ci.yml)
- [.github/workflows/pages.yml](/home/david/Mermaid2PowerPoint/.github/workflows/pages.yml)

推到 GitHub 后：

- `CI` 会自动执行 `npm ci` 和 `npm test`
- `Pages` 会在主分支推送后发布静态网页
