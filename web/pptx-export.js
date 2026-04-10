import { parseMermaidFlowchartSvgElement } from "./svg-parser.js";
import { parseColor, pxToIn, pxToPt, tintColor } from "./export-utils.js";

const DEFAULT_LAYOUT_NAME = "MERMAID_FLOWCHART";
const DEFAULT_NODE_FILL = "ECECFF";
const DEFAULT_NODE_STROKE = "9370DB";
const DEFAULT_TEXT_COLOR = "333333";
const DEFAULT_LINE_COLOR = "333333";
const DEFAULT_EDGE_LABEL_FILL = "E8E8E8";

export async function exportSvgElementToPptx(svgElement, options = {}) {
  const pptx = await buildPresentation(svgElement, options);
  await pptx.writeFile({
    fileName: normalizePptxFileName(options.fileName),
    compression: true,
  });
}

async function buildPresentation(svgElement, options = {}) {
  const PptxGenJS = window.PptxGenJS;
  if (typeof PptxGenJS !== "function") {
    throw new Error("PptxGenJS browser bundle is not loaded.");
  }

  const diagram = parseMermaidFlowchartSvgElement(svgElement);
  const paddingPx = options.slidePaddingPx ?? 24;
  const slideWidthIn = pxToIn(diagram.viewBox.width + paddingPx * 2);
  const slideHeightIn = pxToIn(diagram.viewBox.height + paddingPx * 2);
  const title = resolvePresentationTitle(options.fileName, options.title);

  const pptx = new PptxGenJS();
  pptx.defineLayout({
    name: DEFAULT_LAYOUT_NAME,
    width: slideWidthIn,
    height: slideHeightIn,
  });
  pptx.layout = DEFAULT_LAYOUT_NAME;
  pptx.author = options.author ?? "Mermaid2PowerPoint";
  pptx.company = options.company ?? "Mermaid2PowerPoint";
  pptx.subject = "Editable PowerPoint generated from Mermaid SVG in the browser";
  pptx.title = title;

  const slide = pptx.addSlide();
  const background = parseColor(options.backgroundColor) ?? diagram.background;
  if (background) {
    slide.background = { color: background.hex };
  }

  addClusters(slide, diagram, paddingPx);
  addEdges(slide, pptx, diagram, paddingPx);
  addNodes(slide, pptx, diagram, paddingPx);
  await addImageNodes(slide, pptx, diagram, paddingPx, svgElement.ownerDocument.baseURI);
  addFloatingTexts(slide, diagram, paddingPx);
  return pptx;
}

function addClusters(slide, diagram, paddingPx) {
  for (const cluster of diagram.clusters) {
    slide.addShape("rect", {
      x: mapX(diagram, paddingPx, cluster.x),
      y: mapY(diagram, paddingPx, cluster.y),
      w: pxToIn(cluster.width),
      h: pxToIn(cluster.height),
      fill: {
        color: cluster.style.fill?.hex ?? "FFFFDE",
        transparency: cluster.style.fill?.transparency ?? 0,
      },
      line: {
        color: cluster.style.stroke?.hex ?? "AAAA33",
        transparency: cluster.style.stroke?.transparency ?? 0,
        width: pxToPt(cluster.style.strokeWidthPx ?? 1),
        dashType: dashTypeFromPattern(cluster.style.dashPattern),
      },
    });

    if (cluster.label) {
      addText(slide, diagram, paddingPx, cluster.label);
    }
  }
}

function addEdges(slide, pptx, diagram, paddingPx) {
  for (const edge of diagram.edges) {
    if (shouldUseCustomGeometry(edge)) {
      addCustomGeometryEdge(slide, pptx, diagram, paddingPx, edge);
    } else {
      addPolylineEdge(slide, pptx, diagram, paddingPx, edge);
    }

    if (edge.label) {
      addText(slide, diagram, paddingPx, edge.label, resolveEdgeLabelPresentation(edge));
    }
  }
}

function addNodes(slide, pptx, diagram, paddingPx) {
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

function addFloatingTexts(slide, diagram, paddingPx) {
  for (const text of diagram.floatingTexts) {
    addText(slide, diagram, paddingPx, text);
  }
}

async function addImageNodes(slide, _pptx, diagram, paddingPx, baseUri) {
  for (const imageNode of diagram.imageNodes) {
    if (imageNode.frameStyle?.fill || imageNode.frameStyle?.stroke) {
      slide.addShape("rect", {
        x: mapX(diagram, paddingPx, imageNode.x),
        y: mapY(diagram, paddingPx, imageNode.y),
        w: pxToIn(imageNode.width),
        h: pxToIn(imageNode.height),
        fill: imageNode.frameStyle.fill
          ? {
              color: imageNode.frameStyle.fill.hex,
              transparency: imageNode.frameStyle.fill.transparency,
            }
          : {
              color: "FFFFFF",
              transparency: 100,
            },
        line: imageNode.frameStyle.stroke
          ? {
              color: imageNode.frameStyle.stroke.hex,
              transparency: imageNode.frameStyle.stroke.transparency,
              width: pxToPt(imageNode.frameStyle.strokeWidthPx ?? 1),
              dashType: dashTypeFromPattern(imageNode.frameStyle.dashPattern),
            }
          : undefined,
      });
    }

    slide.addImage({
      data: await normalizeImageData(imageNode.href, baseUri),
      x: mapX(diagram, paddingPx, imageNode.x),
      y: mapY(diagram, paddingPx, imageNode.y),
      w: pxToIn(imageNode.width),
      h: pxToIn(imageNode.height),
    });

    if (imageNode.label) {
      addText(slide, diagram, paddingPx, imageNode.label);
    }
  }
}

function addText(slide, diagram, paddingPx, text, presentation = {}) {
  const boxStyle = presentation.boxStyle ?? text.boxStyle;
  const lineStyle = boxStyle?.stroke
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
    margin: presentation.marginPt ?? (text.role === "edge" ? 2 : 0),
    fontFace: text.style.fontFamily ?? "Trebuchet MS",
    fontSize: pxToPt(text.style.fontSizePx ?? 16),
    color: presentation.colorHex ?? text.style.color?.hex ?? DEFAULT_TEXT_COLOR,
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

function addPolylineEdge(slide, pptx, diagram, paddingPx, edge) {
  for (let index = 0; index < edge.points.length - 1; index += 1) {
    const from = edge.points[index];
    const to = edge.points[index + 1];
    const segment = buildLineSegment(
      pptx,
      from,
      to,
      edge,
      diagram,
      paddingPx,
      index === 0,
      index === edge.points.length - 2
    );

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

function addCustomGeometryEdge(slide, pptx, diagram, paddingPx, edge) {
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

function buildLineSegment(pptx, from, to, edge, diagram, paddingPx, isFirstSegment, isLastSegment) {
  const minX = Math.min(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  const inverted = (to.x - from.x) * (to.y - from.y) < 0;
  const shapeType = inverted ? pptx.ShapeType.lineInv : pptx.ShapeType.line;
  const baseStart = inverted
    ? { x: minX, y: minY + height }
    : { x: minX, y: minY };
  const actualStartsAtBaseStart = isSamePoint(from, baseStart);
  const color = edge.style.stroke?.hex ?? DEFAULT_LINE_COLOR;
  const transparency = edge.style.stroke?.transparency ?? 0;

  return {
    shapeType,
    x: mapX(diagram, paddingPx, minX),
    y: mapY(diagram, paddingPx, minY),
    w: pxToIn(Math.max(width, 0.5)),
    h: pxToIn(Math.max(height, 0.5)),
    color,
    transparency,
    widthPt: pxToPt(edge.style.strokeWidthPx ?? 2),
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

function resolveEdgeLabelPresentation(edge) {
  const edgeColor = edge.style.stroke ?? { hex: DEFAULT_LINE_COLOR, transparency: 0 };
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

function shouldUseCustomGeometry(edge) {
  return Boolean(edge.geometry && (edge.geometry.hasCurves || edge.points.length > 2));
}

function normalizeBounds(bounds) {
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(bounds.width, 0.5),
    height: Math.max(bounds.height, 0.5),
  };
}

function toCustomGeometryPoint(command, bounds) {
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
    default:
      return { close: false };
  }
}

function getShapeType(pptx, node) {
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

function dashTypeFromPattern(pattern) {
  if (pattern === "dot") {
    return "sysDot";
  }

  if (pattern === "dash") {
    return "dash";
  }

  return "solid";
}

function mapX(diagram, paddingPx, x) {
  return pxToIn(x - diagram.viewBox.minX + paddingPx);
}

function mapY(diagram, paddingPx, y) {
  return pxToIn(y - diagram.viewBox.minY + paddingPx);
}

async function normalizeImageData(href, baseUri) {
  if (href.startsWith("data:")) {
    return href;
  }

  const imageUrl = new URL(href, baseUri).toString();
  const response = await fetch(imageUrl, {
    mode: "cors",
    cache: "force-cache",
  });
  if (!response.ok) {
    throw new Error(`无法读取图片节点资源: ${imageUrl}`);
  }

  const blob = await response.blob();
  return blobToDataUrl(blob);
}

function blobToDataUrl(blob) {
  return new Promise((resolvePromise, rejectPromise) => {
    const reader = new FileReader();
    reader.onload = () => resolvePromise(String(reader.result));
    reader.onerror = () => rejectPromise(new Error("无法把图片转换成浏览器内嵌数据。"));
    reader.readAsDataURL(blob);
  });
}

function normalizePptxFileName(fileName) {
  const trimmed = (fileName || "mermaid-diagram").trim();
  return trimmed.toLowerCase().endsWith(".pptx") ? trimmed : `${trimmed}.pptx`;
}

function resolvePresentationTitle(fileName, explicitTitle) {
  if (explicitTitle) {
    return explicitTitle;
  }

  return normalizePptxFileName(fileName).replace(/\.pptx$/i, "");
}

function isSamePoint(left, right) {
  return Math.abs(left.x - right.x) < 0.001 && Math.abs(left.y - right.y) < 0.001;
}
