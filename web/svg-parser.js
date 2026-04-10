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
  const consumed = new Set();
  const edgeLabelMap = buildEdgeLabelMap(svgRoot, consumed);
  const clusters = parseClusters(svgRoot, consumed);
  const nodes = parseNodes(svgRoot, consumed);
  const imageNodes = parseImageNodes(svgRoot, consumed);
  const edges = parseEdges(svgRoot, edgeLabelMap, consumed);
  const genericShapes = parseGenericShapes(svgRoot, consumed);
  const floatingTexts = parseFloatingTexts(svgRoot, consumed);

  return {
    viewBox,
    background,
    clusters,
    nodes,
    imageNodes,
    genericShapes,
    edges,
    floatingTexts,
  };
}

function parseClusters(svgRoot, consumed) {
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
    const label = labelElement ? parseLabelText(labelElement, "free", consumed) : undefined;
    consumed.add(rect);

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

function parseNodes(svgRoot, consumed) {
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
      style: shape.style ?? resolveShapeStyle(shape.styleElement),
      text: parseLabelText(element, "node", consumed),
    });
    for (const consumedElement of shape.consumedElements) {
      consumed.add(consumedElement);
    }
  }

  return nodes;
}

function parseImageNodes(svgRoot, consumed) {
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
    consumed.add(imageElement);
    for (const framePath of getImageFramePathElements(element)) {
      consumed.add(framePath);
    }
    imageNodes.push({
      id: element.getAttribute("id") ?? `image-node-${imageNodes.length + 1}`,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      href,
      preserveAspectRatio: imageElement.getAttribute("preserveAspectRatio") ?? undefined,
      frameStyle: resolveImageFrameStyle(element),
      label: labelElement ? parseLabelText(labelElement, "node", consumed) : undefined,
    });
  }

  return imageNodes;
}

function parseNodeShape(nodeElement) {
  const directChildren = Array.from(nodeElement.children);

  for (const child of directChildren) {
    if (child.tagName.toLowerCase() === "path" && hasRenderableShapeStyle(child)) {
      const geometry = getAbsolutePathGeometry(child);
      if (geometry) {
        return {
          kind: classifyPathNodeKind(geometry),
          bounds: geometry.bounds,
          styleElement: child,
          consumedElements: [child],
        };
      }
    }

    if (!hasLabelContainerClass(child)) {
      continue;
    }

    const tagName = child.tagName.toLowerCase();
    if (tagName === "rect") {
      const bounds = getBoundingBoxFromRect(child);
      if (bounds) {
        return { kind: "rect", bounds, styleElement: child, consumedElements: [child] };
      }
    }

    if (tagName === "circle" || tagName === "ellipse") {
      const bounds = getBoundingBoxFromEllipse(child);
      if (bounds) {
        return { kind: "ellipse", bounds, styleElement: child, consumedElements: [child] };
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
          consumedElements: [child],
        };
      }
    }
  }

  for (const child of directChildren) {
    if (child.tagName.toLowerCase() !== "g" || !hasOuterPathGroupClass(child)) {
      continue;
    }

    const pathChildren = Array.from(child.children).filter((element) => element.tagName.toLowerCase() === "path");
    const bounds = unionBoundingBoxes(
      pathChildren
        .map((pathChild) => getBoundingBoxFromPath(pathChild))
        .filter(Boolean)
    );

    if (bounds) {
      const styleElements = pathChildren.filter((pathChild) => hasRenderableShapeStyle(pathChild));
      const styleElement = styleElements[0] ?? child;
      const mergedStyle = mergeShapeStyles(styleElements.map((pathChild) => resolveShapeStyle(pathChild)));
      const kind = classifyPathNodeKind(getAbsolutePathGeometry(styleElement) ?? {
        bounds,
        commands: [],
        hasCurves: false,
      });
      return {
        kind,
        bounds,
        styleElement,
        consumedElements: pathChildren,
        style: mergedStyle,
      };
    }
  }

  return undefined;
}

function parseEdges(svgRoot, edgeLabelMap, consumed) {
  const edges = [];

  for (const element of svgRoot.querySelectorAll(".edgePaths path, path.flowchart-link")) {
    const id = element.getAttribute("data-id") ?? element.getAttribute("id") ?? `edge-${edges.length + 1}`;
    const geometry = getAbsolutePathGeometry(element);
    const points = decodePathPoints(element.getAttribute("data-points")) ?? geometryToPoints(geometry);
    if (points.length < 2) {
      continue;
    }
    consumed.add(element);

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

function parseFloatingTexts(svgRoot, consumed) {
  const texts = [];
  const seen = new Set();

  for (const child of Array.from(svgRoot.children)) {
    if (child.tagName?.toLowerCase() !== "text") {
      continue;
    }

    const parsed = parseTextElement(child, "free", consumed);
    if (parsed) {
      pushUniqueText(texts, seen, parsed);
    }
  }

  for (const element of svgRoot.querySelectorAll(".flowchartTitleText")) {
    const parsed = parseTextElement(element, "free", consumed);
    if (parsed) {
      pushUniqueText(texts, seen, parsed);
    }
  }

  for (const element of svgRoot.querySelectorAll("foreignObject, text")) {
    if (consumed.has(element) || hasConsumedAncestor(element, consumed) || hasIgnoredGenericAncestor(element)) {
      continue;
    }

    const parsed = element.tagName.toLowerCase() === "foreignobject"
      ? parseForeignObjectText(element, "free", consumed)
      : parseTextElement(element, "free", consumed);
    if (parsed) {
      pushUniqueText(texts, seen, parsed);
    }
  }

  return texts;
}

function buildEdgeLabelMap(svgRoot, consumed) {
  const labels = new Map();

  for (const element of svgRoot.querySelectorAll(".edgeLabels .label[data-id]")) {
    const id = element.getAttribute("data-id");
    if (!id) {
      continue;
    }

    const parsed = parseLabelText(element, "edge", consumed);
    if (parsed?.text) {
      labels.set(id, parsed);
    }
  }

  return labels;
}

function parseLabelText(container, role, consumed) {
  const foreignObject = container.querySelector("foreignObject");
  if (foreignObject) {
    return parseForeignObjectText(foreignObject, role, consumed);
  }

  const textElement = container.querySelector("text");
  if (textElement) {
    return parseTextElement(textElement, role, consumed);
  }

  return undefined;
}

function parseForeignObjectText(element, role, consumed) {
  const text = normalizeWhitespace(element.textContent ?? "");
  if (!text) {
    return undefined;
  }
  consumed?.add(element);

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

function parseTextElement(element, role, consumed) {
  const text = normalizeWhitespace(element.textContent ?? "");
  if (!text) {
    return undefined;
  }
  consumed?.add(element);

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

function classifyPresetPolygonKind(points) {
  if (points.length >= 6) {
    return "hexagon";
  }

  if (points.length === 4) {
    return "diamond";
  }

  return undefined;
}

function classifyPathNodeKind(geometry) {
  return geometry.hasCurves ? "roundRect" : "rect";
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
  return mergeShapeStyles(
    getImageFramePathElements(container).map((pathElement) => resolveShapeStyle(pathElement))
  );
}

function getImageFramePathElements(container) {
  return Array.from(container.querySelectorAll("path"))
    .filter((pathElement) => !pathElement.closest(".label"));
}

function parseGenericShapes(svgRoot, consumed) {
  const genericShapes = [];

  for (const element of svgRoot.querySelectorAll("rect, circle, ellipse, polygon, path, line, polyline")) {
    if (consumed.has(element) || hasConsumedAncestor(element, consumed) || hasIgnoredGenericAncestor(element)) {
      continue;
    }

    const parsed = parseGenericShape(element, genericShapes.length + 1);
    if (!parsed) {
      continue;
    }

    consumed.add(element);
    genericShapes.push(parsed);
  }

  return genericShapes;
}

function parseGenericShape(element, index) {
  const tagName = element.tagName.toLowerCase();
  const style = resolveShapeStyle(element);
  const id = element.getAttribute("id") ?? `generic-shape-${index}`;

  switch (tagName) {
    case "rect": {
      const bounds = getBoundingBoxFromRect(element);
      if (!bounds || !hasRenderableShapeStyle(element)) {
        return undefined;
      }

      const rx = parseNumber(element.getAttribute("rx")) ?? 0;
      const ry = parseNumber(element.getAttribute("ry")) ?? 0;
      return {
        id,
        kind: rx > 0 || ry > 0 ? "roundRect" : "rect",
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        style,
        closed: true,
      };
    }
    case "circle":
    case "ellipse": {
      const bounds = getBoundingBoxFromEllipse(element);
      if (!bounds || !hasRenderableShapeStyle(element)) {
        return undefined;
      }

      return {
        id,
        kind: "ellipse",
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        style,
        closed: true,
      };
    }
    case "line": {
      const points = getAbsoluteLinePoints(element);
      if (!points || !style.stroke) {
        return undefined;
      }

      return {
        id,
        kind: "line",
        x: Math.min(points[0].x, points[1].x),
        y: Math.min(points[0].y, points[1].y),
        width: Math.abs(points[1].x - points[0].x),
        height: Math.abs(points[1].y - points[0].y),
        points,
        style: {
          ...style,
          fill: undefined,
        },
        startArrow: element.getAttribute("marker-start") ? "triangle" : undefined,
        endArrow: element.getAttribute("marker-end") ? "triangle" : undefined,
        closed: false,
      };
    }
    case "polyline":
    case "polygon": {
      const rawPoints = parsePoints(element.getAttribute("points"));
      const points = getAbsolutePoints(element, rawPoints);
      if (points.length < 2 || !hasRenderableShapeStyle(element)) {
        return undefined;
      }

      const bounds = getBoundingBoxFromPolygon(element, rawPoints);
      if (!bounds) {
        return undefined;
      }

      const isPolygon = tagName === "polygon";
      if (isPolygon) {
        const presetKind = classifyPresetPolygonKind(points);
        if (presetKind) {
          return {
            id,
            kind: presetKind,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            style,
            closed: true,
          };
        }
      }

      const geometry = pointsToGeometry(points, isPolygon);
      return {
        id,
        kind: points.length === 2 && !isPolygon && style.stroke ? "line" : "customGeometry",
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        geometry: points.length === 2 && !isPolygon ? undefined : geometry,
        points: points.length === 2 && !isPolygon ? points : undefined,
        style: points.length === 2 && !isPolygon
          ? {
              ...style,
              fill: undefined,
            }
          : style,
        startArrow: element.getAttribute("marker-start") ? "triangle" : undefined,
        endArrow: element.getAttribute("marker-end") ? "triangle" : undefined,
        closed: isPolygon,
      };
    }
    case "path": {
      const geometry = getAbsolutePathGeometry(element);
      if (!geometry || !hasRenderableShapeStyle(element)) {
        return undefined;
      }

      const closed = geometry.commands.some((command) => command.type === "close") || Boolean(style.fill);
      const points = geometryToPoints(geometry);
      if (!closed && points.length === 2 && !geometry.hasCurves && style.stroke) {
        return {
          id,
          kind: "line",
          x: Math.min(points[0].x, points[1].x),
          y: Math.min(points[0].y, points[1].y),
          width: Math.abs(points[1].x - points[0].x),
          height: Math.abs(points[1].y - points[0].y),
          points,
          style: {
            ...style,
            fill: undefined,
          },
          startArrow: element.getAttribute("marker-start") ? "triangle" : undefined,
          endArrow: element.getAttribute("marker-end") ? "triangle" : undefined,
          closed: false,
        };
      }

      return {
        id,
        kind: "customGeometry",
        x: geometry.bounds.x,
        y: geometry.bounds.y,
        width: geometry.bounds.width,
        height: geometry.bounds.height,
        geometry,
        style,
        startArrow: element.getAttribute("marker-start") ? "triangle" : undefined,
        endArrow: element.getAttribute("marker-end") ? "triangle" : undefined,
        closed,
      };
    }
    default:
      return undefined;
  }
}

function getAbsoluteLinePoints(element) {
  const x1 = parseNumber(element.getAttribute("x1"));
  const y1 = parseNumber(element.getAttribute("y1"));
  const x2 = parseNumber(element.getAttribute("x2"));
  const y2 = parseNumber(element.getAttribute("y2"));
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    return undefined;
  }

  const offset = getAbsoluteTranslate(element);
  return [
    { x: offset.x + x1, y: offset.y + y1 },
    { x: offset.x + x2, y: offset.y + y2 },
  ];
}

function getAbsolutePoints(element, points) {
  const offset = getAbsoluteTranslate(element);
  return points.map((point) => ({
    x: point.x + offset.x,
    y: point.y + offset.y,
  }));
}

function pointsToGeometry(points, closed) {
  if (points.length < 2) {
    return undefined;
  }

  const bounds = unionBoundingBoxes(
    points.map((point) => ({
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
    }))
  );
  if (!bounds) {
    return undefined;
  }

  return {
    bounds,
    commands: [
      { type: "moveTo", x: points[0].x, y: points[0].y },
      ...points.slice(1).map((point) => ({ type: "lineTo", x: point.x, y: point.y })),
      ...(closed ? [{ type: "close" }] : []),
    ],
    hasCurves: false,
  };
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

function mergeShapeStyles(styles) {
  const renderableStyles = styles.filter((style) => style?.fill || style?.stroke);
  if (renderableStyles.length === 0) {
    return undefined;
  }

  return renderableStyles.reduce((merged, current) => ({
    fill: merged.fill ?? current.fill,
    stroke: merged.stroke ?? current.stroke,
    strokeWidthPx: merged.strokeWidthPx ?? current.strokeWidthPx,
    dashPattern: merged.dashPattern ?? current.dashPattern,
  }), {});
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

function hasOuterPathGroupClass(element) {
  return element.classList.contains("outer-path") || hasRoundedOuterPathClass(element);
}

function hasRenderableShapeStyle(element) {
  const style = resolveShapeStyle(element);
  return Boolean(style.fill || style.stroke);
}

function hasIgnoredGenericAncestor(element) {
  return Boolean(element.closest("defs, marker, style, clipPath, mask, pattern, symbol, filter"));
}

function hasConsumedAncestor(element, consumed) {
  let current = element.parentElement;
  while (current) {
    if (consumed.has(current)) {
      return true;
    }

    current = current.parentElement;
  }

  return false;
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
