import PptxGenJSImport from "pptxgenjs";

import { parseMermaidFlowchartSvg } from "./parseSvg.js";
import type { ConvertSvgToPptxOptions, ParsedDiagram, ParsedEdge, ParsedNode, ParsedText, PointPx } from "./types.js";
import { pxToIn, pxToPt } from "./utils.js";

const DEFAULT_LAYOUT_NAME = "MERMAID_FLOWCHART";
const DEFAULT_NODE_FILL = "ECECFF";
const DEFAULT_NODE_STROKE = "9370DB";
const DEFAULT_TEXT_COLOR = "333333";
const DEFAULT_LINE_COLOR = "333333";
const PptxGenJS = PptxGenJSImport as unknown as { new (): any };

export async function convertSvgToPptx(
  svgString: string,
  outputPath: string,
  options: ConvertSvgToPptxOptions = {}
): Promise<void> {
  const { pptx } = buildPresentation(svgString, options);
  await pptx.writeFile({ fileName: outputPath });
}

export async function convertSvgToPptxBuffer(
  svgString: string,
  options: ConvertSvgToPptxOptions = {}
): Promise<Buffer> {
  const { pptx } = buildPresentation(svgString, options);
  const output = await pptx.write({ outputType: "nodebuffer" });
  if (Buffer.isBuffer(output)) {
    return output;
  }

  if (output instanceof Uint8Array) {
    return Buffer.from(output);
  }

  if (output instanceof ArrayBuffer) {
    return Buffer.from(output);
  }

  throw new Error("Unexpected PPTX export result. Expected Buffer-compatible binary output.");
}

function buildPresentation(
  svgString: string,
  options: ConvertSvgToPptxOptions = {}
): { diagram: ParsedDiagram; paddingPx: number; pptx: any } {
  const diagram = parseMermaidFlowchartSvg(svgString);
  const paddingPx = options.slidePaddingPx ?? 24;
  const slideWidthIn = pxToIn(diagram.viewBox.width + paddingPx * 2);
  const slideHeightIn = pxToIn(diagram.viewBox.height + paddingPx * 2);

  const pptx = new PptxGenJS();
  pptx.defineLayout({
    name: DEFAULT_LAYOUT_NAME,
    width: slideWidthIn,
    height: slideHeightIn,
  });
  pptx.layout = DEFAULT_LAYOUT_NAME;
  pptx.author = options.author ?? "Mermaid2PowerPoint";
  pptx.company = options.company ?? "Mermaid2PowerPoint";
  pptx.subject = "Editable PowerPoint generated from Mermaid SVG";
  pptx.title = options.title ?? "Mermaid diagram";

  const slide = pptx.addSlide();
  if (diagram.background) {
    slide.background = { color: diagram.background.hex };
  }

  addEdges(slide, pptx, diagram, paddingPx);
  addNodes(slide, pptx, diagram, paddingPx);
  addFloatingTexts(slide, diagram, paddingPx);

  return { diagram, paddingPx, pptx };
}

function addEdges(slide: any, pptx: any, diagram: ParsedDiagram, paddingPx: number): void {
  for (const edge of diagram.edges) {
    for (let index = 0; index < edge.points.length - 1; index += 1) {
      const from = edge.points[index];
      const to = edge.points[index + 1];
      const isFirstSegment = index === 0;
      const isLastSegment = index === edge.points.length - 2;
      const segment = buildLineSegment(pptx, from, to, edge, diagram, paddingPx, isFirstSegment, isLastSegment);

      slide.addShape(segment.shapeType, {
        x: segment.x,
        y: segment.y,
        w: segment.w,
        h: segment.h,
        line: {
          color: segment.color,
          transparency: segment.transparency,
          width: segment.widthPt,
          dashType: segment.dashType,
          beginArrowType: segment.beginArrowType,
          endArrowType: segment.endArrowType,
        },
      });
    }

    if (edge.label) {
      addText(slide, diagram, paddingPx, edge.label, {
        fillColor: "E8E8E8",
        fillTransparency: 20,
      });
    }
  }
}

function addNodes(slide: any, pptx: any, diagram: ParsedDiagram, paddingPx: number): void {
  for (const node of diagram.nodes) {
    slide.addShape(getShapeType(pptx, node), {
      x: mapX(diagram, paddingPx, node.x),
      y: mapY(diagram, paddingPx, node.y),
      w: pxToIn(node.width),
      h: pxToIn(node.height),
      fill: {
        color: node.style.fill?.hex ?? DEFAULT_NODE_FILL,
        transparency: node.style.fill?.transparency ?? 0,
      },
      line: {
        color: node.style.stroke?.hex ?? DEFAULT_NODE_STROKE,
        transparency: node.style.stroke?.transparency ?? 0,
        width: pxToPt(node.style.strokeWidthPx ?? 1),
      },
    });

    if (node.text) {
      addText(slide, diagram, paddingPx, node.text);
    }
  }
}

function addFloatingTexts(slide: any, diagram: ParsedDiagram, paddingPx: number): void {
  for (const text of diagram.floatingTexts) {
    addText(slide, diagram, paddingPx, text);
  }
}

function addText(
  slide: any,
  diagram: ParsedDiagram,
  paddingPx: number,
  text: ParsedText,
  boxStyle?: { fillColor?: string; fillTransparency?: number }
): void {
  slide.addText(text.text, {
    x: mapX(diagram, paddingPx, text.x),
    y: mapY(diagram, paddingPx, text.y),
    w: pxToIn(text.width),
    h: pxToIn(text.height),
    margin: 0,
    fontFace: text.style.fontFamily ?? "Trebuchet MS",
    fontSize: pxToPt(text.style.fontSizePx ?? 16),
    color: text.style.color?.hex ?? DEFAULT_TEXT_COLOR,
    align: text.style.align ?? "center",
    valign: "middle",
    fit: "shrink",
    fill: boxStyle?.fillColor
      ? {
          color: boxStyle.fillColor,
          transparency: boxStyle.fillTransparency ?? 0,
        }
      : undefined,
    line: boxStyle?.fillColor
      ? {
          color: boxStyle.fillColor,
          transparency: 100,
        }
      : undefined,
  });
}

function buildLineSegment(
  pptx: any,
  from: PointPx,
  to: PointPx,
  edge: ParsedEdge,
  diagram: ParsedDiagram,
  paddingPx: number,
  isFirstSegment: boolean,
  isLastSegment: boolean
): {
  shapeType: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  transparency: number;
  widthPt: number;
  dashType: string;
  beginArrowType?: string;
  endArrowType?: string;
} {
  const minX = Math.min(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  const inverted = (to.x - from.x) * (to.y - from.y) < 0;
  const shapeType = inverted ? pptx.ShapeType.lineInv : pptx.ShapeType.line;
  const baseStart = inverted
    ? { x: minX, y: minY + height }
    : { x: minX, y: minY };
  const baseEnd = inverted
    ? { x: minX + width, y: minY }
    : { x: minX + width, y: minY + height };
  const actualStartsAtBaseStart = isSamePoint(from, baseStart);
  const color = edge.style.stroke?.hex ?? DEFAULT_LINE_COLOR;
  const transparency = edge.style.stroke?.transparency ?? 0;
  const widthPt = pxToPt(edge.style.strokeWidthPx ?? 2);

  return {
    shapeType,
    x: mapX(diagram, paddingPx, minX),
    y: mapY(diagram, paddingPx, minY),
    w: pxToIn(Math.max(width, 0.5)),
    h: pxToIn(Math.max(height, 0.5)),
    color,
    transparency,
    widthPt,
    dashType: edge.style.dashPattern === "dot" ? "sysDot" : edge.style.dashPattern === "dash" ? "dash" : "solid",
    beginArrowType:
      (isFirstSegment && edge.startArrow && !actualStartsAtBaseStart) ||
      (isLastSegment && edge.endArrow && actualStartsAtBaseStart)
        ? "triangle"
        : undefined,
    endArrowType:
      (isFirstSegment && edge.startArrow && actualStartsAtBaseStart) ||
      (isLastSegment && edge.endArrow && !actualStartsAtBaseStart)
        ? "triangle"
        : undefined,
  };
}

function isSamePoint(left: PointPx, right: PointPx): boolean {
  return Math.abs(left.x - right.x) < 0.001 && Math.abs(left.y - right.y) < 0.001;
}

function getShapeType(pptx: any, node: ParsedNode): string {
  return node.kind === "diamond" ? pptx.ShapeType.diamond : pptx.ShapeType.rect;
}

function mapX(diagram: ParsedDiagram, paddingPx: number, x: number): number {
  return pxToIn(x - diagram.viewBox.minX + paddingPx);
}

function mapY(diagram: ParsedDiagram, paddingPx: number, y: number): number {
  return pxToIn(y - diagram.viewBox.minY + paddingPx);
}
