# Mermaid2PowerPoint

将 Mermaid flowchart 转成真正可编辑的 PowerPoint 原生 Shape，而不是图片。

在线写 Mermaid，实时看语法和预览，然后下载可编辑的 `.pptx`。

## 为什么这个项目值得用

- 输出的是 PowerPoint 原生 shape/text，不是截图
- 网页里直接编辑 Mermaid，实时语法检查
- 支持本地 Web 界面、CLI、Node API 三种使用方式
- 适合做流程图转汇报材料、产品方案、售前提案
- 已带自动化测试和 GitHub Actions CI

当前 MVP 走的是一条务实路线：

1. 先把 Mermaid 渲染成 SVG，拿到已经算好的布局坐标。
2. 解析 SVG 中的节点、文本、连线。
3. 用 `pptxgenjs` 在 PPT 里重建矩形、菱形、文本框和箭头线段。

## 当前能力

- 支持 `flowchart` / `graph` 类 Mermaid SVG
- 支持矩形节点 `<rect>`
- 支持判断节点 `<polygon>` 并映射成菱形
- 支持 Mermaid 的 `foreignObject` 文本标签
- 支持普通 SVG `<text>`
- 支持连接线 `<path>`，优先使用 Mermaid 的 `data-points` 还原折线
- 输出为原生 PowerPoint shape/text，不嵌入图片

## 当前限制

- 目前只针对基础 flowchart 做了 MVP 级支持
- 不保证复杂自定义节点、图标、子图、泳道、时序图、脑图等 Mermaid 类型正确映射
- 曲线路径会优先降级为折线段，目标是“可编辑”和“结构正确”，不是 100% 还原 SVG 曲线
- 文本样式目前只保留常用信息：字体、字号、颜色、对齐

## 项目结构

- `src/parseSvg.ts`: Mermaid SVG 解析器，包含 `parseRect`、`parseText`、`parsePath`
- `src/pptx.ts`: SVG 坐标到 PptxGenJS shape 的映射
- `src/mermaidCliRenderer.ts`: 调用 `mmdc` 把 `.mmd` 渲染成 SVG
- `src/server.ts`: 本地网页服务和 `/api/export` 下载接口
- `src/cli.ts`: 命令行入口
- `src/examples/mockSvgDemo.ts`: 用 mock SVG 生成可编辑 PPT 的最小示例
- `web/`: 网页编辑器、预览界面和下载前端
- `scripts/build-pages.mjs`: 生成 GitHub Pages 静态站点产物

## 安装

推荐使用 Node.js 22。Node.js 20 目前也能跑，但安装 `@mermaid-js/mermaid-cli` 时可能会看到上游依赖的 engine warning。

```bash
npm install
```

仓库已经把 `@mermaid-js/mermaid-cli` 放进 `devDependencies`，所以普通 `npm install` 就会一起装好。

如果你想改成全局安装，也可以让 `mmdc` 在 `PATH` 里可见，或者通过 `--mmdc-path` 显式指定。

## 用法

### 1. 启动网页

```bash
npm run dev
```

然后打开：

```text
http://127.0.0.1:3000
```

网页支持：

- Mermaid 输入编辑
- 实时语法检查
- 浏览器内 SVG 预览
- 调用本地后端生成可编辑 PPT 并下载

如果你在容器、CI 或受限 Linux 环境里运行网页服务，建议这样启动：

```bash
MERMAID_NO_SANDBOX=1 npm run dev
```

生产运行方式：

```bash
npm run build
npm start
```

### GitHub Pages

仓库已经带了 GitHub Pages 工作流：

- [.github/workflows/pages.yml](/home/david/Mermaid2PowerPoint/.github/workflows/pages.yml)

它会把 `web/` 和 Mermaid 浏览器运行时打包成静态站点并发布到 Pages。

需要注意：

- GitHub Pages 只能托管静态页面，不能运行当前项目的 Node 导出 API
- 所以 Pages 上支持 Mermaid 编辑、语法检查、预览
- Pages 上默认不支持直接导出 PPT，下载按钮会自动禁用
- 真正导出可编辑 PPT 仍然需要本地运行 `npm run dev` 或你后续部署一个独立后端

本地预构建 Pages 产物：

```bash
npm run pages:build
```

### 2. 直接把 SVG 转成可编辑 PPT

```bash
npm run build
node dist/cli.js output.svg --input svg -o editable-output.pptx
```

### 3. 从 Mermaid 源文件直接转

```bash
npm run build
node dist/cli.js examples/simple-flow.mmd -o editable-flow.pptx
```

如果你在容器、CI 或受限 Linux 环境里运行，建议加上：

```bash
node dist/cli.js examples/simple-flow.mmd -o editable-flow.pptx --no-sandbox
```

代码里也会在检测到 Chromium sandbox 启动失败时自动重试一次 no-sandbox 配置。

可选参数：

- `--theme <name>`: Mermaid 主题
- `--background <color>`: Mermaid 背景色
- `--scale <number>`: Mermaid 渲染缩放
- `--padding <px>`: 幻灯片边距，单位是 SVG 像素
- `--mmdc-path <path>`: 显式指定 `mmdc`
- `--puppeteer-config <path>`: 传给 Mermaid CLI 的 Puppeteer 配置文件
- `--no-sandbox`: 给 Chromium 增加 `--no-sandbox --disable-setuid-sandbox`

## 编程接口

### `convertSvgToPptx(svgString, outputPath)`

```ts
import { convertSvgToPptx } from "./dist/index.js";

const svg = `<svg viewBox="0 0 200 100">...</svg>`;
await convertSvgToPptx(svg, "diagram.pptx");
```

### Mock SVG 示例

```bash
npm run build
node dist/examples/mockSvgDemo.js
```

这会生成一个只包含 2 个矩形节点和 1 条连接线的 `mock-flowchart.pptx`。

## 测试

```bash
npm test
```

当前测试包含：

- Mermaid SVG 解析测试
- SVG -> PPTX 原生 shape 导出测试
- `.mmd -> .pptx` 端到端测试
- 网页 `/api/export` 接口集成测试

## 验证结果

已经在本地完成了这些 smoke test：

- `node dist/examples/mockSvgDemo.js`
- `node dist/cli.js output.svg --input svg -o editable-output.pptx`
- `npm run dev` 后访问首页并通过 `/api/export` 下载 PPT

生成的 PPTX 中没有 `<p:pic>` 图片对象，只有 PowerPoint shape/text 节点，说明输出的是原生可编辑元素。

## GitHub CI

仓库已经增加了 GitHub Actions 工作流：

- [.github/workflows/ci.yml](/home/david/Mermaid2PowerPoint/.github/workflows/ci.yml)
- [.github/workflows/pages.yml](/home/david/Mermaid2PowerPoint/.github/workflows/pages.yml)

推到 GitHub 后：

- `CI` 会自动执行 `npm ci` 和 `npm test`
- `Pages` 会在 `main` 分支推送后发布静态网页

## 后续建议

下一步值得补的能力：

1. 支持更多 Mermaid 节点形状，例如圆角矩形、圆、六边形
2. 补 edge label 的背景框、主题色和彩色边框
3. 改进曲线路径映射，减少对折线降级
4. 为常见 Mermaid 示例补一组回归测试

## 旧方案

仓库里的 `mermaid2ppt.py` 仍然保留，作为旧的“图片/EMF 嵌入 PPT”方案参考。新的 TypeScript 实现才是可编辑原生 Shape 的主线。
