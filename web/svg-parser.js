import { geometryToPoints, parseSvgPathData, unionBoundingBoxes } from "./svg-path.js";
import {
  decodeBase64Utf8,
  estimateTextBox,
  normalizeWhitespace,
  parseColor,
  parseNumber,
  parsePoints,
  parseTranslate,
  resolveShapeStyle,
  resolveTextBoxStyle,
  resolveTextStyle,
  safeGetBBox,
} from "./export-utils.js";

export function parseMermaidFlowchartSvgElement(svgRoot) {
  if (!(svgRoot instanceof SVGElement) || svgRoot.tagName.toLowerCase() !== "svg") {
    throw new Error("Expected a rendered Mermaid <svg> element.");
  }

  const viewBox = parseViewBox(svgRoot.getAttribute("viewBox"), svgRoot.getAttribute("width"), svgRoot.getAttribute("height"));
  const background = parseSvgBackground(svgRoot);
  const edgeLabelMap = buildEdgeLabelMap(svgRoot);
  const clusters = parseClusters(svgRoot);
  const nodes = parseNodes(svgRoot);
  const imageNodes = parseImageNodes(svgRoot);
  const edges = parseEdges(svgRoot, edgeLabelMap);
  const floatingTexts = parseFloatingTexts(svgRoot);

  return {
    viewBox,
    background,
    clusters,
    nodes,
    imageNodes,
    edges,
    floatingTexts,
  };
}

function parseClusters(svgRoot) {
  const clusters = [];

  for (const element of svgRoot.querySelectorAll(".clusters .cluster")) {
    const rect = findDirectChild(element, (child) => child.tagName.toLowerCase() === "rect");
    if (!rect) {
      continue;
    }

    const bounds = getBoundingBoxFromRect(rect);
    if (!bounds) {
      continue;
    }

    const labelElement = findDirectChild(element, (child) => child.classList.contains("cluster-label"));
    const label = labelElement ? parseLabelText(labelElement, "free") : undefined;

    clusters.push({
      id: element.getAttribute("id") ?? `cluster-${clusters.length + 1}`,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      style: resolveShapeStyle(rect),
      label,
    });
  }

  return clusters;
}

function parseNodes(svgRoot) {
  const nodes = [];

  for (const element of svgRoot.querySelectorAll("g.node")) {
    const shape = parseNodeShape(element);
    if (!shape) {
      continue;
    }

    nodes.push({
      id: element.getAttribute("id") ?? `node-${nodes.length + 1}`,
      kind: shape.kind,
      x: shape.bounds.x,
      y: shape.bounds.y,
      width: shape.bounds.width,
      height: shape.bounds.height,
      style: resolveShapeStyle(shape.styleElement),
      text: parseLabelText(element, "node"),
    });
  }

  return nodes;
}

function parseImageNodes(svgRoot) {
  const imageNodes = [];

  for (const element of svgRoot.querySelectorAll(".image-shape")) {
    const imageElement = element.querySelector("image");
    if (!imageElement) {
      continue;
    }

    const bounds = getBoundingBoxFromImage(imageElement);
    if (!bounds) {
      continue;
    }

    const href = imageElement.getAttribute("href") ?? imageElement.getAttribute("xlink:href");
    if (!href) {
      continue;
    }

    const labelElement = findDirectChild(element, (child) => child.classList.contains("label"));
    imageNodes.push({
      id: element.getAttribute("id") ?? `image-node-${imageNodes.length + 1}`,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      href,
      preserveAspectRatio: imageElement.getAttribute("preserveAspectRatio") ?? undefined,
      frameStyle: resolveImageFrameStyle(element),
      label: labelElement ? parseLabelText(labelElement, "node") : undefined,
    });
  }

  return imageNodes;
}

function parseNodeShape(nodeElement) {
  const directChildren = Array.from(nodeElement.children);

  for (const child of directChildren) {
    if (!hasLabelContainerClass(child)) {
      continue;
    }

    const tagName = child.tagName.toLowerCase();
    if (tagName === "rect") {
      const bounds = getBoundingBoxFromRect(child);
      if (bounds) {
        return { kind: "rect", bounds, styleElement: child };
      }
    }

    if (tagName === "circle" || tagName === "ellipse") {
      const bounds = getBoundingBoxFromEllipse(child);
      if (bounds) {
        return { kind: "ellipse", bounds, styleElement: child };
      }
    }

    if (tagName === "polygon") {
      const points = parsePoints(child.getAttribute("points"));
      const bounds = getBoundingBoxFromPolygon(child, points);
      if (bounds) {
        return {
          kind: classifyPolygonKind(points),
          bounds,
          styleElement: child,
        };
      }
    }
  }

  for (const child of directChildren) {
    if (child.tagName.toLowerCase() !== "g" || !hasRoundedOuterPathClass(child)) {
      continue;
    }

    const pathChildren = Array.from(child.children).filter((element) => element.tagName.toLowerCase() === "path");
    const bounds = unionBoundingBoxes(
      pathChildren
        .map((pathChild) => getBoundingBoxFromPath(pathChild))
        .filter(Boolean)
    );

    if (bounds) {
      const styleElement = pathChildren.find((pathChild) => hasRenderableShapeStyle(pathChild)) ?? child;
      return {
        kind: "roundRect",
        bounds,
        styleElement,
      };
    }
  }

  return undefined;
}

function parseEdges(svgRoot, edgeLabelMap) {
  const edges = [];

  for (const element of svgRoot.querySelectorAll(".edgePaths path, path.flowchart-link")) {
    const id = element.getAttribute("data-id") ?? element.getAttribute("id") ?? `edge-${edges.length + 1}`;
    const geometry = getAbsolutePathGeometry(element);
    const points = decodePathPoints(element.getAttribute("data-points")) ?? geometryToPoints(geometry);
    if (points.length < 2) {
      continue;
    }

    edges.push({
      id,
      points,
      geometry,
      style: {
        ...resolveShapeStyle(element),
        fill: undefined,
      },
      startArrow: element.getAttribute("marker-start") ? "triangle" : undefined,
      endArrow: element.getAttribute("marker-end") ? "triangle" : undefined,
      label: edgeLabelMap.get(id),
    });
  }

  return edges;
}

function parseFloatingTexts(svgRoot) {
  const texts = [];
  const seen = new Set();

  for (const child of Array.from(svgRoot.children)) {
    if (child.tagName?.toLowerCase() !== "text") {
      continue;
    }

    const parsed = parseTextElement(child, "free");
    if (parsed) {
      pushUniqueText(texts, seen, parsed);
    }
  }

  for (const element of svgRoot.querySelectorAll(".flowchartTitleText")) {
    const parsed = parseTextElement(element, "free");
    if (parsed) {
      pushUniqueText(texts, seen, parsed);
    }
  }

  return texts;
}

function buildEdgeLabelMap(svgRoot) {
  const labels = new Map();

  for (const element of svgRoot.querySelectorAll(".edgeLabels .label[data-id]")) {
    const id = element.getAttribute("data-id");
    if (!id) {
      continue;
    }

    const parsed = parseLabelText(element, "edge");
    if (parsed?.text) {
      labels.set(id, parsed);
    }
  }

  return labels;
}

function parseLabelText(container, role) {
  const foreignObject = container.querySelector("foreignObject");
  if (foreignObject) {
    return parseForeignObjectText(foreignObject, role);
  }

  const textElement = container.querySelector("text");
  if (textElement) {
    return parseTextElement(textElement, role);
  }

  return undefined;
}

function parseForeignObjectText(element, role) {
  const text = normalizeWhitespace(element.textContent ?? "");
  if (!text) {
    return undefined;
  }

  const x = parseNumber(element.getAttribute("x")) ?? 0;
  const y = parseNumber(element.getAttribute("y")) ?? 0;
  const width = parseNumber(element.getAttribute("width")) ?? 0;
  const height = parseNumber(element.getAttribute("height")) ?? 0;
  const offset = getAbsoluteTranslate(element);
  const textStyleSource = element.querySelector("span, p, div") ?? element;
  const boxStyleSource = element.querySelector(".labelBkg, .edgeLabel") ?? textStyleSource;

  return {
    id: element.parentElement?.getAttribute("data-id") ?? undefined,
    role,
    text,
    x: offset.x + x,
    y: offset.y + y,
    width,
    height,
    style: resolveTextStyle(textStyleSource),
    boxStyle: role === "edge" ? resolveTextBoxStyle(boxStyleSource) : undefined,
  };
}

function parseTextElement(element, role) {
  const text = normalizeWhitespace(element.textContent ?? "");
  if (!text) {
    return undefined;
  }

  const resolvedStyle = resolveTextStyle(element);
  const fontSizePx = resolvedStyle.fontSizePx ?? 16;
  const bbox = safeGetBBox(element);
  const estimate = bbox && bbox.width > 0 && bbox.height > 0
    ? { width: bbox.width, height: bbox.height }
    : estimateTextBox(text, fontSizePx);
  const x = parseNumber(element.getAttribute("x"));
  const y = parseNumber(element.getAttribute("y"));

  if (x === undefined || y === undefined) {
    return {
      role,
      text,
      x: bbox?.x ?? 0,
      y: bbox?.y ?? 0,
      width: estimate.width,
      height: estimate.height,
      style: resolvedStyle,
    };
  }

  const offset = getAbsoluteTranslate(element);
  const textAnchor = window.getComputedStyle(element).textAnchor?.trim();
  const left = textAnchor === "middle" ? offset.x + x - estimate.width / 2 : offset.x + x;
  const top = offset.y + y - estimate.height * 0.85;

  return {
    role,
    text,
    x: left,
    y: top,
    width: estimate.width,
    height: estimate.height,
    style: resolvedStyle,
  };
}

function classifyPolygonKind(points) {
  if (points.length >= 6) {
    return "hexagon";
  }

  return "diamond";
}

function getBoundingBoxFromRect(element) {
  const x = parseNumber(element.getAttribute("x"));
  const y = parseNumber(element.getAttribute("y"));
  const width = parseNumber(element.getAttribute("width"));
  const height = parseNumber(element.getAttribute("height"));
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }

  const offset = getAbsoluteTranslate(element);
  return {
    x: offset.x + x,
    y: offset.y + y,
    width,
    height,
  };
}

function getBoundingBoxFromEllipse(element) {
  const offset = getAbsoluteTranslate(element);
  const tagName = element.tagName.toLowerCase();
  const cx = parseNumber(element.getAttribute("cx")) ?? 0;
  const cy = parseNumber(element.getAttribute("cy")) ?? 0;

  if (tagName === "circle") {
    const r = parseNumber(element.getAttribute("r"));
    if (r === undefined) {
      return undefined;
    }

    return {
      x: offset.x + cx - r,
      y: offset.y + cy - r,
      width: r * 2,
      height: r * 2,
    };
  }

  const rx = parseNumber(element.getAttribute("rx"));
  const ry = parseNumber(element.getAttribute("ry"));
  if (rx === undefined || ry === undefined) {
    return undefined;
  }

  return {
    x: offset.x + cx - rx,
    y: offset.y + cy - ry,
    width: rx * 2,
    height: ry * 2,
  };
}

function getBoundingBoxFromPolygon(element, parsedPoints = parsePoints(element.getAttribute("points"))) {
  if (parsedPoints.length === 0) {
    return undefined;
  }

  const offset = getAbsoluteTranslate(element);
  const xs = parsedPoints.map((point) => point.x + offset.x);
  const ys = parsedPoints.map((point) => point.y + offset.y);

  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

function getBoundingBoxFromPath(element) {
  const geometry = parseSvgPathData(element.getAttribute("d"));
  if (!geometry) {
    return undefined;
  }

  const offset = getAbsoluteTranslate(element);
  return {
    x: geometry.bounds.x + offset.x,
    y: geometry.bounds.y + offset.y,
    width: geometry.bounds.width,
    height: geometry.bounds.height,
  };
}

function getBoundingBoxFromImage(element) {
  const width = parseNumber(element.getAttribute("width"));
  const height = parseNumber(element.getAttribute("height"));
  if (width === undefined || height === undefined) {
    return undefined;
  }

  const x = parseNumber(element.getAttribute("x")) ?? 0;
  const y = parseNumber(element.getAttribute("y")) ?? 0;
  const offset = getAbsoluteTranslate(element);

  return {
    x: offset.x + x,
    y: offset.y + y,
    width,
    height,
  };
}

function resolveImageFrameStyle(container) {
  const styles = Array.from(container.querySelectorAll("path"))
    .filter((pathElement) => !pathElement.closest(".label"))
    .map((pathElement) => resolveShapeStyle(pathElement))
    .filter((style) => Boolean(style.fill || style.stroke));

  if (styles.length === 0) {
    return undefined;
  }

  return styles.reduce((merged, current) => ({
    fill: merged.fill ?? current.fill,
    stroke: merged.stroke ?? current.stroke,
    strokeWidthPx: merged.strokeWidthPx ?? current.strokeWidthPx,
    dashPattern: merged.dashPattern ?? current.dashPattern,
  }), {});
}

function getAbsolutePathGeometry(element) {
  const geometry = parseSvgPathData(element.getAttribute("d"));
  if (!geometry) {
    return undefined;
  }

  const offset = getAbsoluteTranslate(element);
  return {
    ...geometry,
    bounds: {
      x: geometry.bounds.x + offset.x,
      y: geometry.bounds.y + offset.y,
      width: geometry.bounds.width,
      height: geometry.bounds.height,
    },
    commands: geometry.commands.map((command) => {
      switch (command.type) {
        case "moveTo":
        case "lineTo":
          return { ...command, x: command.x + offset.x, y: command.y + offset.y };
        case "quadraticTo":
          return {
            ...command,
            x1: command.x1 + offset.x,
            y1: command.y1 + offset.y,
            x: command.x + offset.x,
            y: command.y + offset.y,
          };
        case "cubicTo":
          return {
            ...command,
            x1: command.x1 + offset.x,
            y1: command.y1 + offset.y,
            x2: command.x2 + offset.x,
            y2: command.y2 + offset.y,
            x: command.x + offset.x,
            y: command.y + offset.y,
          };
        case "close":
          return command;
        default:
          return command;
      }
    }),
  };
}

function decodePathPoints(dataPoints) {
  if (!dataPoints) {
    return undefined;
  }

  try {
    const decoded = decodeBase64Utf8(dataPoints);
    const parsed = JSON.parse(decoded);
    return parsed
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .map((point) => ({ x: point.x, y: point.y }));
  } catch {
    return undefined;
  }
}

function parseViewBox(viewBoxAttr, widthAttr, heightAttr) {
  if (viewBoxAttr) {
    const values = String(viewBoxAttr).split(/[\s,]+/).map((value) => Number.parseFloat(value));
    if (values.length === 4 && values.every((value) => Number.isFinite(value))) {
      const [minX, minY, width, height] = values;
      return { minX, minY, width, height };
    }
  }

  const width = parseNumber(widthAttr);
  const height = parseNumber(heightAttr);
  if (width !== undefined && height !== undefined) {
    return { minX: 0, minY: 0, width, height };
  }

  throw new Error("Unable to determine SVG dimensions. Expected viewBox or width/height.");
}

function parseSvgBackground(svgRoot) {
  return parseColor(window.getComputedStyle(svgRoot).backgroundColor || svgRoot.style.backgroundColor);
}

function getAbsoluteTranslate(element) {
  let current = element;
  let x = 0;
  let y = 0;

  while (current) {
    if (current instanceof Element) {
      const translation = parseTranslate(current.getAttribute("transform"));
      x += translation.x;
      y += translation.y;
    }

    current = current.parentElement;
  }

  return { x, y };
}

function hasLabelContainerClass(element) {
  return element.classList.contains("label-container");
}

function hasRoundedOuterPathClass(element) {
  return element.classList.contains("label-container") && element.classList.contains("outer-path");
}

function hasRenderableShapeStyle(element) {
  const style = resolveShapeStyle(element);
  return Boolean(style.fill || style.stroke);
}

function findDirectChild(element, predicate) {
  return Array.from(element.children).find((child) => predicate(child));
}

function pushUniqueText(texts, seen, parsed) {
  const key = `${parsed.text}|${parsed.x.toFixed(2)}|${parsed.y.toFixed(2)}|${parsed.role}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  texts.push(parsed);
}
