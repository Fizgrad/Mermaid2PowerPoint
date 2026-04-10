import { load } from "cheerio";
import type { AnyNode, Element } from "domhandler";

import { geometryToPoints, parseSvgPathData, unionBoundingBoxes } from "./svgPath.js";
import type {
  BoundingBox,
  ColorValue,
  ParsedCluster,
  ParsedDiagram,
  ParsedEdge,
  ParsedGenericShape,
  ParsedImageNode,
  ParsedNode,
  ParsedPathGeometry,
  ParsedText,
  PointPx,
  ShapeStyle,
  TextStyle,
  ViewBox,
} from "./types.js";
import {
  estimateTextBox,
  normalizeWhitespace,
  parseColor,
  parseNumber,
  parsePoints,
  parseTranslate,
  stripCssPriority,
} from "./utils.js";

interface CssRule {
  declarations: Record<string, string>;
  selectors: string[];
}

interface ResolvedStyle {
  backgroundColor?: string;
  color?: string;
  fill?: string;
  fontFamily?: string;
  fontSize?: string;
  stroke?: string;
  strokeDasharray?: string;
  strokeWidth?: string;
  textAlign?: string;
  textAnchor?: string;
}

interface NodeShapeDescriptor {
  kind: ParsedNode["kind"];
  bounds: BoundingBox;
  styleElement: Element;
  consumedElements: Element[];
  style?: ShapeStyle;
}

export function parseRect(svgString: string): ParsedNode[] {
  const diagram = parseMermaidFlowchartSvg(svgString);
  return diagram.nodes.filter((node) => node.kind === "rect");
}

export function parseText(svgString: string): ParsedText[] {
  const diagram = parseMermaidFlowchartSvg(svgString);
  const nodeTexts = diagram.nodes.flatMap((node) => (node.text ? [node.text] : []));
  const clusterTexts = diagram.clusters.flatMap((cluster) => (cluster.label ? [cluster.label] : []));
  const imageTexts = diagram.imageNodes.flatMap((imageNode) => (imageNode.label ? [imageNode.label] : []));
  const edgeTexts = diagram.edges.flatMap((edge) => (edge.label ? [edge.label] : []));
  return [...clusterTexts, ...nodeTexts, ...imageTexts, ...edgeTexts, ...diagram.floatingTexts];
}

export function parsePath(svgString: string): ParsedEdge[] {
  const diagram = parseMermaidFlowchartSvg(svgString);
  return diagram.edges;
}

export function parseMermaidFlowchartSvg(svgString: string): ParsedDiagram {
  const $ = load(svgString, {
    xml: {
      xmlMode: true,
    },
  });

  const cssRules = extractCssRules($);
  const svgRoot = $("svg").first();
  if (svgRoot.length === 0) {
    throw new Error("Input does not contain an <svg> root element.");
  }

  const viewBox = parseViewBox(svgRoot.attr("viewBox"), svgRoot.attr("width"), svgRoot.attr("height"));
  const background = parseSvgBackground(svgRoot.attr("style"));
  const consumed = new Set<Element>();
  const edgeLabelMap = buildEdgeLabelMap($, cssRules, consumed);
  const clusters = parseClusters($, cssRules, consumed);
  const nodes = parseNodes($, cssRules, consumed);
  const imageNodes = parseImageNodes($, cssRules, consumed);
  const edges = parseEdges($, cssRules, edgeLabelMap, consumed);
  const genericShapes = parseGenericShapes($, cssRules, consumed);
  const floatingTexts = parseFloatingTexts($, cssRules, consumed);

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

function parseClusters($: ReturnType<typeof load>, cssRules: CssRule[], consumed: Set<Element>): ParsedCluster[] {
  const clusters: ParsedCluster[] = [];

  $(".clusters .cluster").each((_, element) => {
    const rect = $(element).children("rect").first()[0];
    if (!rect || !isElement(rect)) {
      return;
    }

    const bounds = getBoundingBoxFromRect($, rect);
    if (!bounds) {
      return;
    }

    const labelElement = $(element).children(".cluster-label").first()[0];
    const label = labelElement && isElement(labelElement)
      ? parseLabelText($, cssRules, labelElement, "free", consumed)
      : undefined;
    consumed.add(rect);

    clusters.push({
      id: $(element).attr("id") ?? `cluster-${clusters.length + 1}`,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      style: resolveShapeStyle($, cssRules, rect),
      label,
    });
  });

  return clusters;
}

function parseNodes($: ReturnType<typeof load>, cssRules: CssRule[], consumed: Set<Element>): ParsedNode[] {
  const nodes: ParsedNode[] = [];

  $("g.node").each((_, element) => {
    const shape = parseNodeShape($, cssRules, element);
    if (!shape) {
      return;
    }

    const id = $(element).attr("id") ?? `node-${nodes.length + 1}`;
    const text = parseLabelText($, cssRules, element, "node", consumed);
    for (const consumedElement of shape.consumedElements) {
      consumed.add(consumedElement);
    }

    nodes.push({
      id,
      kind: shape.kind,
      x: shape.bounds.x,
      y: shape.bounds.y,
      width: shape.bounds.width,
      height: shape.bounds.height,
      style: shape.style ?? resolveShapeStyle($, cssRules, shape.styleElement),
      text,
    });
  });

  return nodes;
}

function parseImageNodes($: ReturnType<typeof load>, cssRules: CssRule[], consumed: Set<Element>): ParsedImageNode[] {
  const imageNodes: ParsedImageNode[] = [];

  $(".image-shape").each((_, element) => {
    const imageElement = $(element).find("image").first()[0];
    if (!imageElement || !isElement(imageElement)) {
      return;
    }

    const bounds = getBoundingBoxFromImage($, imageElement);
    if (!bounds) {
      return;
    }

    const href = $(imageElement).attr("href") ?? $(imageElement).attr("xlink:href");
    if (!href) {
      return;
    }

    const labelElement = $(element).children(".label").first()[0];
    const label = labelElement && isElement(labelElement)
      ? parseLabelText($, cssRules, labelElement, "node", consumed)
      : undefined;
    consumed.add(imageElement);
    for (const framePath of getImageFramePathElements($, element)) {
      consumed.add(framePath);
    }
    imageNodes.push({
      id: $(element).attr("id") ?? `image-node-${imageNodes.length + 1}`,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      href,
      preserveAspectRatio: $(imageElement).attr("preserveAspectRatio") ?? undefined,
      frameStyle: resolveImageFrameStyle($, cssRules, element),
      label,
    });
  });

  return imageNodes;
}

function parseNodeShape(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  nodeElement: Element
): NodeShapeDescriptor | undefined {
  const directChildren = $(nodeElement)
    .children()
    .toArray()
    .filter(isElement);

  for (const child of directChildren) {
    if (child.tagName === "path" && hasRenderableShapeStyle($, cssRules, child)) {
      const geometry = getAbsolutePathGeometry($, child);
      if (geometry) {
        return {
          kind: classifyPathNodeKind(geometry),
          bounds: geometry.bounds,
          styleElement: child,
          consumedElements: [child],
        };
      }
    }

    if (!hasLabelContainerClass($, child)) {
      continue;
    }

    if (child.tagName === "rect") {
      const bounds = getBoundingBoxFromRect($, child);
      if (bounds) {
        return {
          kind: "rect",
          bounds,
          styleElement: child,
          consumedElements: [child],
        };
      }
    }

    if (child.tagName === "circle" || child.tagName === "ellipse") {
      const bounds = getBoundingBoxFromEllipse($, child);
      if (bounds) {
        return {
          kind: "ellipse",
          bounds,
          styleElement: child,
          consumedElements: [child],
        };
      }
    }

    if (child.tagName === "polygon") {
      const points = parsePoints($(child).attr("points"));
      const bounds = getBoundingBoxFromPolygon($, child, points);
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
    if (child.tagName !== "g" || !hasOuterPathGroupClass($, child)) {
      continue;
    }

    const pathChildren = $(child)
      .children("path")
      .toArray()
      .filter(isElement);
    const bounds = unionBoundingBoxes(
      pathChildren
        .map((pathChild) => getBoundingBoxFromPath($, pathChild))
        .filter((box): box is BoundingBox => Boolean(box))
    );

    if (bounds) {
      const styleElements = pathChildren.filter((pathChild) => hasRenderableShapeStyle($, cssRules, pathChild));
      const styleElement = styleElements[0] ?? child;
      const mergedStyle = mergeShapeStyles(styleElements.map((pathChild) => resolveShapeStyle($, cssRules, pathChild)));
      const kind = classifyPathNodeKind(getAbsolutePathGeometry($, styleElement) ?? {
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

function parseEdges(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  edgeLabelMap: Map<string, ParsedText>,
  consumed: Set<Element>
): ParsedEdge[] {
  const edges: ParsedEdge[] = [];

  $(".edgePaths path, path.flowchart-link").each((_, element) => {
    const id = $(element).attr("data-id") ?? $(element).attr("id") ?? `edge-${edges.length + 1}`;
    const style = resolveShapeStyle($, cssRules, element);
    const geometry = getAbsolutePathGeometry($, element);
    const points = decodePathPoints($(element).attr("data-points")) ?? geometryToPoints(geometry);

    if (points.length < 2) {
      return;
    }
    consumed.add(element);

    edges.push({
      id,
      points,
      geometry,
      style: {
        ...style,
        fill: undefined,
      },
      startArrow: $(element).attr("marker-start") ? "triangle" : undefined,
      endArrow: $(element).attr("marker-end") ? "triangle" : undefined,
      label: edgeLabelMap.get(id),
    });
  });

  return edges;
}

function parseFloatingTexts($: ReturnType<typeof load>, cssRules: CssRule[], consumed: Set<Element>): ParsedText[] {
  const floatingTexts: ParsedText[] = [];
  const seen = new Set<string>();

  $("svg > text, .cluster-label text, .flowchartTitleText").each((_, element) => {
    const text = parseTextElement($, cssRules, element, "free", consumed);
    if (text) {
      pushUniqueText(floatingTexts, seen, text);
    }
  });

  $("foreignObject, text").each((_, element) => {
    if (!isElement(element)) {
      return;
    }

    if (consumed.has(element) || hasConsumedAncestor(element, consumed)) {
      return;
    }

    if (hasIgnoredGenericAncestor($, element)) {
      return;
    }

    const parsed = element.tagName === "foreignObject"
      ? parseForeignObjectText($, cssRules, element, "free", consumed)
      : parseTextElement($, cssRules, element, "free", consumed);
    if (parsed) {
      pushUniqueText(floatingTexts, seen, parsed);
    }
  });

  return floatingTexts;
}

function buildEdgeLabelMap(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  consumed: Set<Element>
): Map<string, ParsedText> {
  const labels = new Map<string, ParsedText>();

  $(".edgeLabels .label[data-id]").each((_, element) => {
    const id = $(element).attr("data-id");
    if (!id) {
      return;
    }

    const parsed = parseLabelText($, cssRules, element, "edge", consumed);
    if (parsed && parsed.text) {
      labels.set(id, parsed);
    }
  });

  return labels;
}

function parseLabelText(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  container: Element,
  role: ParsedText["role"],
  consumed: Set<Element>
): ParsedText | undefined {
  const foreignObject = $(container).find("foreignObject").first()[0];
  if (foreignObject) {
    return parseForeignObjectText($, cssRules, foreignObject, role, consumed);
  }

  const textElement = $(container).find("text").first()[0];
  if (textElement) {
    return parseTextElement($, cssRules, textElement, role, consumed);
  }

  return undefined;
}

function parseForeignObjectText(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  element: Element,
  role: ParsedText["role"],
  consumed: Set<Element>
): ParsedText | undefined {
  const text = normalizeWhitespace($(element).text());
  if (!text) {
    return undefined;
  }
  consumed.add(element);

  const x = parseNumber($(element).attr("x")) ?? 0;
  const y = parseNumber($(element).attr("y")) ?? 0;
  const width = parseNumber($(element).attr("width")) ?? 0;
  const height = parseNumber($(element).attr("height")) ?? 0;
  const offset = getAbsoluteTranslate(element);
  const textStyleSource = $(element).find("span, p, div").first()[0] ?? element;
  const boxStyleSource = $(element).find(".labelBkg, .edgeLabel").first()[0];
  const resolvedStyle = resolveStyle($, cssRules, textStyleSource);

  return {
    id: $(element).parent().attr("data-id"),
    role,
    text,
    x: offset.x + x,
    y: offset.y + y,
    width,
    height,
    style: resolveTextStyle(resolvedStyle),
    boxStyle: role === "edge" ? resolveTextBoxStyle($, cssRules, boxStyleSource ?? textStyleSource) : undefined,
  };
}

function parseTextElement(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  element: Element,
  role: ParsedText["role"],
  consumed: Set<Element>
): ParsedText | undefined {
  const text = normalizeWhitespace($(element).text());
  if (!text) {
    return undefined;
  }
  consumed.add(element);

  const resolvedStyle = resolveStyle($, cssRules, element);
  const fontSizePx = parseNumber(resolvedStyle.fontSize) ?? 16;
  const estimate = estimateTextBox(text, fontSizePx);
  const offset = getAbsoluteTranslate(element);
  const x = parseNumber($(element).attr("x")) ?? 0;
  const y = parseNumber($(element).attr("y")) ?? 0;
  const textAnchor = resolvedStyle.textAnchor?.trim();
  const left = textAnchor === "middle" ? offset.x + x - estimate.width / 2 : offset.x + x;
  const top = offset.y + y - estimate.height * 0.85;

  return {
    role,
    text,
    x: left,
    y: top,
    width: estimate.width,
    height: estimate.height,
    style: resolveTextStyle(resolvedStyle),
  };
}

function hasLabelContainerClass($: ReturnType<typeof load>, element: Element): boolean {
  const classes = ($(element).attr("class") ?? "").split(/\s+/).filter(Boolean);
  return classes.includes("label-container");
}

function hasRoundedOuterPathClass($: ReturnType<typeof load>, element: Element): boolean {
  const classes = ($(element).attr("class") ?? "").split(/\s+/).filter(Boolean);
  return classes.includes("label-container") && classes.includes("outer-path");
}

function hasOuterPathGroupClass($: ReturnType<typeof load>, element: Element): boolean {
  const classes = ($(element).attr("class") ?? "").split(/\s+/).filter(Boolean);
  return classes.includes("outer-path") || hasRoundedOuterPathClass($, element);
}

function classifyPolygonKind(points: { x: number; y: number }[]): ParsedNode["kind"] {
  if (points.length >= 6) {
    return "hexagon";
  }

  return "diamond";
}

function classifyPresetPolygonKind(points: { x: number; y: number }[]): ParsedNode["kind"] | undefined {
  if (points.length >= 6) {
    return "hexagon";
  }

  if (points.length === 4) {
    return "diamond";
  }

  return undefined;
}

function classifyPathNodeKind(geometry: ParsedPathGeometry): ParsedNode["kind"] {
  return geometry.hasCurves ? "roundRect" : "rect";
}

function getBoundingBoxFromRect($: ReturnType<typeof load>, element: Element): BoundingBox | undefined {
  const x = parseNumber($(element).attr("x"));
  const y = parseNumber($(element).attr("y"));
  const width = parseNumber($(element).attr("width"));
  const height = parseNumber($(element).attr("height"));

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

function getBoundingBoxFromEllipse($: ReturnType<typeof load>, element: Element): BoundingBox | undefined {
  const offset = getAbsoluteTranslate(element);

  if (element.tagName === "circle") {
    const cx = parseNumber($(element).attr("cx")) ?? 0;
    const cy = parseNumber($(element).attr("cy")) ?? 0;
    const r = parseNumber($(element).attr("r"));
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

  const cx = parseNumber($(element).attr("cx")) ?? 0;
  const cy = parseNumber($(element).attr("cy")) ?? 0;
  const rx = parseNumber($(element).attr("rx"));
  const ry = parseNumber($(element).attr("ry"));

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

function getBoundingBoxFromPolygon(
  $: ReturnType<typeof load>,
  element: Element,
  parsedPoints = parsePoints($(element).attr("points"))
): BoundingBox | undefined {
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

function getBoundingBoxFromPath($: ReturnType<typeof load>, element: Element): BoundingBox | undefined {
  const geometry = parseSvgPathData($(element).attr("d"));
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

function getBoundingBoxFromImage($: ReturnType<typeof load>, element: Element): BoundingBox | undefined {
  const width = parseNumber($(element).attr("width"));
  const height = parseNumber($(element).attr("height"));
  if (width === undefined || height === undefined) {
    return undefined;
  }

  const x = parseNumber($(element).attr("x")) ?? 0;
  const y = parseNumber($(element).attr("y")) ?? 0;
  const offset = getAbsoluteTranslate(element);

  return {
    x: offset.x + x,
    y: offset.y + y,
    width,
    height,
  };
}

function resolveImageFrameStyle(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  container: Element
): ShapeStyle | undefined {
  const candidateStyles = getImageFramePathElements($, container)
    .map((pathElement) => resolveShapeStyle($, cssRules, pathElement));
  return mergeShapeStyles(candidateStyles);
}

function getImageFramePathElements($: ReturnType<typeof load>, container: Element): Element[] {
  return $(container)
    .find("path")
    .toArray()
    .filter(isElement)
    .filter((pathElement) => !$(pathElement).closest(".label").length);
}

function parseGenericShapes(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  consumed: Set<Element>
): ParsedGenericShape[] {
  const genericShapes: ParsedGenericShape[] = [];

  $("rect, circle, ellipse, polygon, path, line, polyline").each((_, element) => {
    if (!isElement(element)) {
      return;
    }

    if (consumed.has(element) || hasConsumedAncestor(element, consumed) || hasIgnoredGenericAncestor($, element)) {
      return;
    }

    const parsed = parseGenericShape($, cssRules, element, genericShapes.length + 1);
    if (!parsed) {
      return;
    }

    consumed.add(element);
    genericShapes.push(parsed);
  });

  return genericShapes;
}

function parseGenericShape(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  element: Element,
  index: number
): ParsedGenericShape | undefined {
  const tagName = element.tagName;
  const style = resolveShapeStyle($, cssRules, element);
  const id = $(element).attr("id") ?? `generic-shape-${index}`;

  switch (tagName) {
    case "rect": {
      const bounds = getBoundingBoxFromRect($, element);
      if (!bounds || !hasRenderableShapeStyle($, cssRules, element)) {
        return undefined;
      }

      const rx = parseNumber($(element).attr("rx")) ?? 0;
      const ry = parseNumber($(element).attr("ry")) ?? 0;
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
      const bounds = getBoundingBoxFromEllipse($, element);
      if (!bounds || !hasRenderableShapeStyle($, cssRules, element)) {
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
      const points = getAbsoluteLinePoints($, element);
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
        startArrow: $(element).attr("marker-start") ? "triangle" : undefined,
        endArrow: $(element).attr("marker-end") ? "triangle" : undefined,
        closed: false,
      };
    }
    case "polyline":
    case "polygon": {
      const points = getAbsolutePoints($, element, parsePoints($(element).attr("points")));
      if (points.length < 2 || !hasRenderableShapeStyle($, cssRules, element)) {
        return undefined;
      }

      const bounds = getBoundingBoxFromPolygon($, element, parsePoints($(element).attr("points")));
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
        startArrow: $(element).attr("marker-start") ? "triangle" : undefined,
        endArrow: $(element).attr("marker-end") ? "triangle" : undefined,
        closed: isPolygon,
      };
    }
    case "path": {
      const geometry = getAbsolutePathGeometry($, element);
      if (!geometry || !hasRenderableShapeStyle($, cssRules, element)) {
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
          startArrow: $(element).attr("marker-start") ? "triangle" : undefined,
          endArrow: $(element).attr("marker-end") ? "triangle" : undefined,
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
        startArrow: $(element).attr("marker-start") ? "triangle" : undefined,
        endArrow: $(element).attr("marker-end") ? "triangle" : undefined,
        closed,
      };
    }
    default:
      return undefined;
  }
}

function getAbsoluteLinePoints($: ReturnType<typeof load>, element: Element): PointPx[] | undefined {
  const x1 = parseNumber($(element).attr("x1"));
  const y1 = parseNumber($(element).attr("y1"));
  const x2 = parseNumber($(element).attr("x2"));
  const y2 = parseNumber($(element).attr("y2"));
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    return undefined;
  }

  const offset = getAbsoluteTranslate(element);
  return [
    { x: offset.x + x1, y: offset.y + y1 },
    { x: offset.x + x2, y: offset.y + y2 },
  ];
}

function getAbsolutePoints(
  $: ReturnType<typeof load>,
  element: Element,
  points: PointPx[]
): PointPx[] {
  const offset = getAbsoluteTranslate(element);
  return points.map((point) => ({
    x: point.x + offset.x,
    y: point.y + offset.y,
  }));
}

function pointsToGeometry(points: PointPx[], closed: boolean): ParsedPathGeometry | undefined {
  if (points.length < 2) {
    return undefined;
  }

  const bounds = unionBoundingBoxes(points.map((point) => ({
    x: point.x,
    y: point.y,
    width: 0,
    height: 0,
  })));
  if (!bounds) {
    return undefined;
  }

  return {
    bounds,
    commands: [
      { type: "moveTo", x: points[0].x, y: points[0].y },
      ...points.slice(1).map((point) => ({ type: "lineTo" as const, x: point.x, y: point.y })),
      ...(closed ? [{ type: "close" as const }] : []),
    ],
    hasCurves: false,
  };
}

function hasIgnoredGenericAncestor($: ReturnType<typeof load>, element: Element): boolean {
  return $(element).closest("defs, marker, style, clipPath, mask, pattern, symbol, filter").length > 0;
}

function hasConsumedAncestor(element: Element, consumed: Set<Element>): boolean {
  let current = element.parent;
  while (current) {
    if (isElement(current) && consumed.has(current)) {
      return true;
    }

    current = current.parent;
  }

  return false;
}

function pushUniqueText(target: ParsedText[], seen: Set<string>, text: ParsedText): void {
  const key = `${text.text}|${text.x.toFixed(2)}|${text.y.toFixed(2)}|${text.role}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  target.push(text);
}

function getAbsolutePathGeometry(
  $: ReturnType<typeof load>,
  element: Element
): ParsedPathGeometry | undefined {
  const geometry = parseSvgPathData($(element).attr("d"));
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
          return {
            ...command,
            x: command.x + offset.x,
            y: command.y + offset.y,
          };
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
      }
    }),
  };
}

function decodePathPoints(dataPoints: string | undefined): { x: number; y: number }[] | undefined {
  if (!dataPoints) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(dataPoints, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as Array<{ x: number; y: number }>;
    return parsed
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .map((point) => ({ x: point.x, y: point.y }));
  } catch {
    return undefined;
  }
}

function parseViewBox(
  viewBoxAttr: string | undefined,
  widthAttr: string | undefined,
  heightAttr: string | undefined
): ViewBox {
  if (viewBoxAttr) {
    const values = viewBoxAttr.split(/[\s,]+/).map((value) => Number.parseFloat(value));
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

function parseSvgBackground(styleAttr: string | undefined): ColorValue | undefined {
  const raw = parseInlineStyle(styleAttr).backgroundColor;
  return parseColor(raw);
}

function mergeShapeStyles(styles: ShapeStyle[]): ShapeStyle | undefined {
  const renderableStyles = styles.filter((style) => Boolean(style.fill || style.stroke));
  if (renderableStyles.length === 0) {
    return undefined;
  }

  return renderableStyles.reduce<ShapeStyle>((merged, current) => ({
    fill: merged.fill ?? current.fill,
    stroke: merged.stroke ?? current.stroke,
    strokeWidthPx: merged.strokeWidthPx ?? current.strokeWidthPx,
    dashPattern: merged.dashPattern ?? current.dashPattern,
  }), {});
}

function resolveShapeStyle(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  element: Element
): ShapeStyle {
  const style = resolveStyle($, cssRules, element);

  return {
    fill: parseColor(style.fill ?? style.backgroundColor),
    stroke: parseColor(style.stroke),
    strokeWidthPx: parseNumber(style.strokeWidth),
    dashPattern: parseDashPattern(style.strokeDasharray),
  };
}

function resolveTextBoxStyle(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  element: Element
): ShapeStyle | undefined {
  const style = resolveStyle($, cssRules, element);
  const resolved: ShapeStyle = {
    fill: parseColor(style.backgroundColor ?? style.fill),
    stroke: parseColor(style.stroke),
    strokeWidthPx: parseNumber(style.strokeWidth),
    dashPattern: parseDashPattern(style.strokeDasharray),
  };

  if (!resolved.fill && !resolved.stroke) {
    return undefined;
  }

  return resolved;
}

function resolveTextStyle(style: ResolvedStyle): TextStyle {
  return {
    color: parseColor(style.color) ?? parseColor(style.fill),
    fontFamily: style.fontFamily,
    fontSizePx: parseNumber(style.fontSize),
    align: parseTextAlign(style.textAlign, style.textAnchor),
  };
}

function parseTextAlign(textAlign: string | undefined, textAnchor: string | undefined): TextStyle["align"] {
  if (textAnchor?.trim() === "middle") {
    return "center";
  }

  if (textAlign?.trim() === "center") {
    return "center";
  }

  if (textAlign?.trim() === "right") {
    return "right";
  }

  return "left";
}

function parseDashPattern(strokeDasharray: string | undefined): ShapeStyle["dashPattern"] {
  if (!strokeDasharray) {
    return "solid";
  }

  const values = strokeDasharray
    .split(/[,\s]+/)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (values.length === 0) {
    return "solid";
  }

  if (values[0] <= 2) {
    return "dot";
  }

  return "dash";
}

function extractCssRules($: ReturnType<typeof load>): CssRule[] {
  const rules: CssRule[] = [];

  $("style").each((_, styleElement) => {
    const stylesheet = $(styleElement).text().replace(/\/\*[\s\S]*?\*\//g, "");
    const rulePattern = /([^{}]+)\{([^{}]+)\}/g;
    let match: RegExpExecArray | null;

    while ((match = rulePattern.exec(stylesheet)) !== null) {
      const rawSelector = match[1].trim();
      if (
        !rawSelector ||
        rawSelector.startsWith("@") ||
        rawSelector === "from" ||
        rawSelector === "to" ||
        rawSelector.endsWith("%")
      ) {
        continue;
      }

      rules.push({
        selectors: rawSelector
          .split(",")
          .map((selector) => selector.trim())
          .filter(Boolean),
        declarations: parseDeclarationBlock(match[2]),
      });
    }
  });

  return rules;
}

function resolveStyle(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  element: Element
): ResolvedStyle {
  const resolved: ResolvedStyle = {};

  const attrMap: Array<[keyof ResolvedStyle, string | undefined]> = [
    ["backgroundColor", $(element).attr("background-color")],
    ["color", $(element).attr("color")],
    ["fill", $(element).attr("fill")],
    ["fontFamily", $(element).attr("font-family")],
    ["fontSize", $(element).attr("font-size")],
    ["stroke", $(element).attr("stroke")],
    ["strokeDasharray", $(element).attr("stroke-dasharray")],
    ["strokeWidth", $(element).attr("stroke-width")],
    ["textAlign", $(element).attr("text-align")],
    ["textAnchor", $(element).attr("text-anchor")],
  ];

  for (const [key, value] of attrMap) {
    if (value) {
      resolved[key] = stripCssPriority(value);
    }
  }

  for (const rule of cssRules) {
    for (const selector of rule.selectors) {
      try {
        if (selectorMatchesElement($, element, selector)) {
          Object.assign(resolved, rule.declarations);
          break;
        }
      } catch {
        continue;
      }
    }
  }

  Object.assign(resolved, parseInlineStyle($(element).attr("style")));

  return resolved;
}

function selectorMatchesElement(
  $: ReturnType<typeof load>,
  element: Element,
  selector: string
): boolean {
  const candidates = new Set<string>([selector.trim()]);
  const strippedRootSelector = selector.replace(/^#[^\s>+~]+(?:\s*(?:>\s*)?)?/, "").trim();
  if (strippedRootSelector) {
    candidates.add(strippedRootSelector);
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    if ($(element).is(candidate)) {
      return true;
    }

    if ($(candidate).toArray().some((matched) => matched === element)) {
      return true;
    }
  }

  return false;
}

function parseDeclarationBlock(raw: string): Record<string, string> {
  const declarations: Record<string, string> = {};

  for (const entry of raw.split(";")) {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = toCamelCase(entry.slice(0, separatorIndex).trim());
    const value = stripCssPriority(entry.slice(separatorIndex + 1));
    if (key && value) {
      declarations[key] = value;
    }
  }

  return declarations;
}

function parseInlineStyle(styleAttr: string | undefined): ResolvedStyle {
  if (!styleAttr) {
    return {};
  }

  return parseDeclarationBlock(styleAttr) as ResolvedStyle;
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function getAbsoluteTranslate(element: AnyNode): { x: number; y: number } {
  let current: AnyNode | null | undefined = element;
  let x = 0;
  let y = 0;

  while (current) {
    if (isElement(current)) {
      const translation = parseTranslate(current.attribs.transform);
      x += translation.x;
      y += translation.y;
    }

    current = current.parent;
  }

  return { x, y };
}

function hasRenderableShapeStyle(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  element: Element
): boolean {
  const style = resolveShapeStyle($, cssRules, element);
  return Boolean(style.fill || style.stroke);
}

function isElement(node: AnyNode): node is Element {
  return node.type === "tag";
}
