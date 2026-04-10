import PptxGenJSImport from "pptxgenjs";

import { parseMermaidFlowchartSvg } from "./parseSvg.js";
import type {
  BoundingBox,
  ConvertSvgToPptxOptions,
  ParsedDiagram,
  ParsedEdge,
  ParsedNode,
  ParsedPathGeometry,
  ParsedText,
  PointPx,
  ShapeStyle,
} from "./types.js";
import { pxToIn, pxToPt, tintColor } from "./utils.js";

const DEFAULT_LAYOUT_NAME = "MERMAID_FLOWCHART";
const DEFAULT_NODE_FILL = "ECECFF";
const DEFAULT_NODE_STROKE = "9370DB";
const DEFAULT_TEXT_COLOR = "333333";
const DEFAULT_LINE_COLOR = "333333";
const DEFAULT_EDGE_LABEL_FILL = "E8E8E8";
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
    if (shouldUseCustomGeometry(edge)) {
      addCustomGeometryEdge(slide, pptx, diagram, paddingPx, edge);
    } else {
      addPolylineEdge(slide, pptx, diagram, paddingPx, edge);
    }

    if (edge.label) {
      const labelPresentation = resolveEdgeLabelPresentation(edge);
      addText(slide, diagram, paddingPx, edge.label, labelPresentation);
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
      rectRadius: node.kind === "roundRect" ? 0.14 : undefined,
      fill: {
        color: node.style.fill?.hex ?? DEFAULT_NODE_FILL,
        transparency: node.style.fill?.transparency ?? 0,
      },
      line: {
        color: node.style.stroke?.hex ?? DEFAULT_NODE_STROKE,
        transparency: node.style.stroke?.transparency ?? 0,
        width: pxToPt(node.style.strokeWidthPx ?? 1),
        dashType: dashTypeFromPattern(node.style.dashPattern),
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
  presentation?: {
    boxStyle?: ShapeStyle;
    colorHex?: string;
    marginPt?: number;
  }
): void {
  const boxStyle = presentation?.boxStyle ?? text.boxStyle;
  const lineStyle = boxStyle && boxStyle.stroke
    ? {
        color: boxStyle.stroke.hex,
        transparency: boxStyle.stroke.transparency,
        width: pxToPt(boxStyle.strokeWidthPx ?? 1),
        dashType: dashTypeFromPattern(boxStyle.dashPattern),
      }
    : boxStyle
      ? {
          color: boxStyle.fill?.hex ?? DEFAULT_EDGE_LABEL_FILL,
          transparency: 100,
          width: 0,
        }
      : undefined;

  slide.addText(text.text, {
    x: mapX(diagram, paddingPx, text.x),
    y: mapY(diagram, paddingPx, text.y),
    w: pxToIn(text.width),
    h: pxToIn(text.height),
    margin: presentation?.marginPt ?? (text.role === "edge" ? 2 : 0),
    fontFace: text.style.fontFamily ?? "Trebuchet MS",
    fontSize: pxToPt(text.style.fontSizePx ?? 16),
    color: presentation?.colorHex ?? text.style.color?.hex ?? DEFAULT_TEXT_COLOR,
    align: text.style.align ?? "center",
    valign: "middle",
    fit: "shrink",
    fill: boxStyle?.fill
      ? {
          color: boxStyle.fill.hex,
          transparency: boxStyle.fill.transparency,
        }
      : undefined,
    line: lineStyle,
  });
}

function addPolylineEdge(slide: any, pptx: any, diagram: ParsedDiagram, paddingPx: number, edge: ParsedEdge): void {
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
}

function addCustomGeometryEdge(
  slide: any,
  pptx: any,
  diagram: ParsedDiagram,
  paddingPx: number,
  edge: ParsedEdge
): void {
  const geometry = edge.geometry;
  if (!geometry) {
    addPolylineEdge(slide, pptx, diagram, paddingPx, edge);
    return;
  }

  const bounds = normalizeBounds(geometry.bounds);
  slide.addShape(pptx.ShapeType.custGeom, {
    x: mapX(diagram, paddingPx, bounds.x),
    y: mapY(diagram, paddingPx, bounds.y),
    w: pxToIn(bounds.width),
    h: pxToIn(bounds.height),
    points: geometry.commands.map((command) => toCustomGeometryPoint(command, bounds)),
    fill: {
      color: "FFFFFF",
      transparency: 100,
    },
    line: {
      color: edge.style.stroke?.hex ?? DEFAULT_LINE_COLOR,
      transparency: edge.style.stroke?.transparency ?? 0,
      width: pxToPt(edge.style.strokeWidthPx ?? 2),
      dashType: dashTypeFromPattern(edge.style.dashPattern),
      beginArrowType: edge.startArrow ? "triangle" : undefined,
      endArrowType: edge.endArrow ? "triangle" : undefined,
    },
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
    dashType: dashTypeFromPattern(edge.style.dashPattern),
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

function resolveEdgeLabelPresentation(edge: ParsedEdge): {
  boxStyle: ShapeStyle;
  colorHex: string;
  marginPt: number;
} {
  const edgeColor = edge.style.stroke ?? {
    hex: DEFAULT_LINE_COLOR,
    transparency: 0,
  };
  const originalBoxStyle = edge.label?.boxStyle;
  const shouldTheme =
    !originalBoxStyle?.stroke &&
    (!originalBoxStyle?.fill || originalBoxStyle.fill.hex === DEFAULT_EDGE_LABEL_FILL);
  const boxStyle = shouldTheme
    ? {
        fill: tintColor(edgeColor, 0.84),
        stroke: edgeColor,
        strokeWidthPx: Math.max(edge.style.strokeWidthPx ?? 1, 1),
      }
    : {
        fill: originalBoxStyle?.fill ?? {
          hex: DEFAULT_EDGE_LABEL_FILL,
          transparency: 20,
        },
        stroke: originalBoxStyle?.stroke ?? edgeColor,
        strokeWidthPx: originalBoxStyle?.strokeWidthPx ?? Math.max((edge.style.strokeWidthPx ?? 1) * 0.75, 1),
        dashPattern: originalBoxStyle?.dashPattern,
      };

  const colorHex =
    edge.label?.style.color?.hex && edge.label.style.color.hex !== DEFAULT_TEXT_COLOR
      ? edge.label.style.color.hex
      : edgeColor.hex;

  return {
    boxStyle,
    colorHex,
    marginPt: 2,
  };
}

function shouldUseCustomGeometry(edge: ParsedEdge): boolean {
  return Boolean(edge.geometry && (edge.geometry.hasCurves || edge.points.length > 2));
}

function normalizeBounds(bounds: BoundingBox): BoundingBox {
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(bounds.width, 0.5),
    height: Math.max(bounds.height, 0.5),
  };
}

function toCustomGeometryPoint(command: ParsedPathGeometry["commands"][number], bounds: BoundingBox): object {
  switch (command.type) {
    case "moveTo":
      return {
        x: pxToIn(command.x - bounds.x),
        y: pxToIn(command.y - bounds.y),
        moveTo: true,
      };
    case "lineTo":
      return {
        x: pxToIn(command.x - bounds.x),
        y: pxToIn(command.y - bounds.y),
      };
    case "quadraticTo":
      return {
        x: pxToIn(command.x - bounds.x),
        y: pxToIn(command.y - bounds.y),
        curve: {
          type: "quadratic",
          x1: pxToIn(command.x1 - bounds.x),
          y1: pxToIn(command.y1 - bounds.y),
        },
      };
    case "cubicTo":
      return {
        x: pxToIn(command.x - bounds.x),
        y: pxToIn(command.y - bounds.y),
        curve: {
          type: "cubic",
          x1: pxToIn(command.x1 - bounds.x),
          y1: pxToIn(command.y1 - bounds.y),
          x2: pxToIn(command.x2 - bounds.x),
          y2: pxToIn(command.y2 - bounds.y),
        },
      };
    case "close":
      return { close: true };
  }
}

function isSamePoint(left: PointPx, right: PointPx): boolean {
  return Math.abs(left.x - right.x) < 0.001 && Math.abs(left.y - right.y) < 0.001;
}

function getShapeType(pptx: any, node: ParsedNode): string {
  switch (node.kind) {
    case "diamond":
      return pptx.ShapeType.diamond;
    case "roundRect":
      return pptx.ShapeType.roundRect;
    case "ellipse":
      return pptx.ShapeType.ellipse;
    case "hexagon":
      return pptx.ShapeType.hexagon;
    case "rect":
    default:
      return pptx.ShapeType.rect;
  }
}

function dashTypeFromPattern(pattern: ShapeStyle["dashPattern"]): string {
  if (pattern === "dot") {
    return "sysDot";
  }

  if (pattern === "dash") {
    return "dash";
  }

  return "solid";
}

function mapX(diagram: ParsedDiagram, paddingPx: number, x: number): number {
  return pxToIn(x - diagram.viewBox.minX + paddingPx);
}

function mapY(diagram: ParsedDiagram, paddingPx: number, y: number): number {
  return pxToIn(y - diagram.viewBox.minY + paddingPx);
}
