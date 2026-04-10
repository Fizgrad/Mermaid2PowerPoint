import { load } from "cheerio";
import type { AnyNode, Element } from "domhandler";

import { geometryToPoints, parseSvgPathData, unionBoundingBoxes } from "./svgPath.js";
import type {
  BoundingBox,
  ColorValue,
  LineArrowType,
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
  geometry?: ParsedPathGeometry;
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
  const sequenceParticipantNodes = parseSequenceParticipantNodes($, cssRules, consumed);
  const nodes = [...sequenceParticipantNodes, ...parseNodes($, cssRules, consumed)];
  const imageNodes = parseImageNodes($, cssRules, consumed);
  const edges = parseEdges($, cssRules, edgeLabelMap, consumed);
  const markerDecorations = parseEdgeMarkerDecorations($, cssRules, edges);
  const genericShapes = parseGenericShapes($, cssRules, consumed);
  const floatingTexts = parseFloatingTexts($, cssRules, consumed);

  return {
    viewBox,
    background,
    clusters,
    nodes,
    imageNodes,
    genericShapes,
    markerDecorations,
    edges,
    floatingTexts,
  };
}

function parseClusters($: ReturnType<typeof load>, cssRules: CssRule[], consumed: Set<Element>): ParsedCluster[] {
  const clusters: ParsedCluster[] = [];

  $(".clusters .cluster, .clusters .statediagram-cluster").each((_, element) => {
    const rect = findPrimaryClusterRect($, element);
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
    $(element)
      .find("rect")
      .toArray()
      .filter(isElement)
      .forEach((clusterRect) => consumed.add(clusterRect));

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

function findPrimaryClusterRect($: ReturnType<typeof load>, element: Element): Element | undefined {
  const directRect = $(element).children("rect").filter(".outer").first()[0] ?? $(element).children("rect").first()[0];
  if (directRect && isElement(directRect)) {
    return directRect;
  }

  const nestedOuterRect = $(element).find("rect.outer").first()[0];
  if (nestedOuterRect && isElement(nestedOuterRect)) {
    return nestedOuterRect;
  }

  const nestedRect = $(element).find("rect").first()[0];
  return nestedRect && isElement(nestedRect) ? nestedRect : undefined;
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
      geometry: shape.geometry,
      text,
    });
  });

  return nodes;
}

function parseSequenceParticipantNodes(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  consumed: Set<Element>
): ParsedNode[] {
  const nodes: ParsedNode[] = [];
  const seen = new Set<string>();

  $("g.actor-man").each((_, element) => {
    if (!isElement(element) || consumed.has(element) || hasConsumedAncestor(element, consumed)) {
      return;
    }

    const parsed = parseActorParticipantNode($, cssRules, element, consumed, nodes.length + 1);
    if (!parsed || seen.has(parsed.id)) {
      return;
    }

    consumed.add(element);
    seen.add(parsed.id);
    nodes.push(parsed);
  });

  $("g").each((_, element) => {
    if (!isElement(element) || consumed.has(element) || hasConsumedAncestor(element, consumed)) {
      return;
    }

    const parsed = parseSequenceParticipantBoxNode($, cssRules, element, consumed, nodes.length + 1);
    if (!parsed || seen.has(parsed.id)) {
      return;
    }

    consumed.add(element);
    seen.add(parsed.id);
    nodes.push(parsed);
  });

  return nodes;
}

function parseActorParticipantNode(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  element: Element,
  consumed: Set<Element>,
  index: number
): ParsedNode | undefined {
  const lines = $(element).children("line").toArray().filter(isElement);
  const circle = $(element).children("circle").first()[0];
  if (!circle || !isElement(circle) || lines.length === 0) {
    return undefined;
  }

  const lineGeometries = lines
    .map((line) => {
      const points = getAbsoluteLinePoints($, line);
      return points && points.length === 2 ? pointsToGeometry(points, false) : undefined;
    })
    .filter((geometry): geometry is ParsedPathGeometry => Boolean(geometry));
  const circleBounds = getBoundingBoxFromEllipse($, circle);
  if (!circleBounds) {
    return undefined;
  }

  const geometry = mergePathGeometries([ellipseBoundsToGeometry(circleBounds), ...lineGeometries]);
  const style = mergeShapeStyles([
    resolveShapeStyle($, cssRules, circle),
    ...lines.map((line) => resolveShapeStyle($, cssRules, line)),
  ]);
  const textElement = $(element).children("text").first()[0];
  const text = textElement && isElement(textElement)
    ? parseTextElement($, cssRules, textElement, "node", consumed)
    : undefined;

  const participantId = $(element).attr("data-id") ?? $(element).attr("name") ?? `actor-${index}`;
  const position = ($(element).attr("class") ?? "").includes("actor-bottom") ? "bottom" : "top";

  lines.forEach((line) => consumed.add(line));
  consumed.add(circle);

  return {
    id: `sequence-actor-${participantId}-${position}`,
    kind: "customGeometry",
    x: geometry.bounds.x,
    y: geometry.bounds.y,
    width: geometry.bounds.width,
    height: geometry.bounds.height,
    style: style ?? resolveShapeStyle($, cssRules, circle),
    geometry,
    text,
  };
}

function parseSequenceParticipantBoxNode(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  element: Element,
  consumed: Set<Element>,
  index: number
): ParsedNode | undefined {
  const rect = $(element)
    .children("rect")
    .toArray()
    .filter(isElement)
    .find((child) => hasActorParticipantRectClass($, child));
  const textElement = $(element)
    .children("text")
    .toArray()
    .filter(isElement)
    .find((child) => hasActorParticipantTextClass($, child));

  if (!rect || !textElement) {
    return undefined;
  }

  const bounds = getBoundingBoxFromRect($, rect);
  if (!bounds) {
    return undefined;
  }

  const rx = parseNumber($(rect).attr("rx")) ?? 0;
  const ry = parseNumber($(rect).attr("ry")) ?? 0;
  const name = $(element).attr("data-id") ?? $(rect).attr("name") ?? ($(textElement).text().trim() || `participant-${index}`);
  const rectClasses = ($(rect).attr("class") ?? "").split(/\s+/).filter(Boolean);
  const position = rectClasses.includes("actor-bottom") ? "bottom" : "top";

  consumed.add(rect);

  return {
    id: `sequence-participant-${name}-${position}`,
    kind: rx > 0 || ry > 0 ? "roundRect" : "rect",
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    style: resolveShapeStyle($, cssRules, rect),
    text: parseTextElement($, cssRules, textElement, "node", consumed),
  };
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
    if ((child.tagName === "circle" || child.tagName === "ellipse") && hasRenderableShapeStyle($, cssRules, child)) {
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

    if (child.tagName === "path" && hasRenderableShapeStyle($, cssRules, child)) {
      const geometry = getAbsolutePathGeometry($, child);
      if (geometry) {
        const kind = classifyPathLikeNodeKind($, child, geometry, [$(child).attr("d") ?? ""]);
        return {
          kind,
          bounds: geometry.bounds,
          styleElement: child,
          geometry: kind === "customGeometry" ? geometry : undefined,
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
        const rx = parseNumber($(child).attr("rx")) ?? 0;
        const ry = parseNumber($(child).attr("ry")) ?? 0;
        return {
          kind: rx > 0 || ry > 0 ? "roundRect" : "rect",
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
        const presetKind = classifyPresetPolygonKind(points);
        const geometry = presetKind ? undefined : pointsToGeometry(getAbsolutePoints($, child, points), true);
        return {
          kind: presetKind ?? "customGeometry",
          bounds,
          styleElement: child,
          geometry,
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
      const rawPathData = styleElements.map((pathChild) => $(pathChild).attr("d") ?? "");
      const geometry = getAbsolutePathGeometry($, styleElement) ?? {
        bounds,
        commands: [],
        hasCurves: false,
      };
      const kind = classifyPathLikeNodeKind($, child, geometry, rawPathData);
      return {
        kind,
        bounds,
        styleElement,
        consumedElements: pathChildren,
        geometry: kind === "customGeometry" ? geometry : undefined,
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
    const startMarkerId = extractMarkerId($(element).attr("marker-start"));
    const endMarkerId = extractMarkerId($(element).attr("marker-end"));

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
      startArrow: parseMarkerArrowType($(element).attr("marker-start")),
      endArrow: parseMarkerArrowType($(element).attr("marker-end")),
      startMarkerId,
      endMarkerId,
      label: edgeLabelMap.get(id),
    });
  });

  return edges;
}

function parseEdgeMarkerDecorations(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  edges: ParsedEdge[]
): ParsedGenericShape[] {
  const shapes: ParsedGenericShape[] = [];

  for (const edge of edges) {
    if (edge.startMarkerId && isDecoratedMarker(edge.startMarkerId) && edge.points.length >= 2) {
      shapes.push(...buildMarkerDecorationShapes($, cssRules, edge, edge.startMarkerId, "start"));
    }

    if (edge.endMarkerId && isDecoratedMarker(edge.endMarkerId) && edge.points.length >= 2) {
      shapes.push(...buildMarkerDecorationShapes($, cssRules, edge, edge.endMarkerId, "end"));
    }
  }

  return shapes;
}

function buildMarkerDecorationShapes(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  edge: ParsedEdge,
  markerId: string,
  side: "start" | "end"
): ParsedGenericShape[] {
  const marker = $(`marker[id="${markerId}"]`).first()[0];
  if (!marker || !isElement(marker)) {
    return [];
  }

  const refX = parseNumber($(marker).attr("refX")) ?? 0;
  const refY = parseNumber($(marker).attr("refY")) ?? 0;
  const anchor = side === "start" ? edge.points[0] : edge.points[edge.points.length - 1];
  const vectorStart = side === "start" ? edge.points[0] : edge.points[edge.points.length - 2];
  const vectorEnd = side === "start" ? edge.points[1] : edge.points[edge.points.length - 1];
  const angle = Math.atan2(vectorEnd.y - vectorStart.y, vectorEnd.x - vectorStart.x);

  return $(marker)
    .children()
    .toArray()
    .filter(isElement)
    .flatMap((child, index) => buildMarkerChildShape($, cssRules, child, edge, markerId, side, index, anchor, refX, refY, angle));
}

function buildMarkerChildShape(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  child: Element,
  edge: ParsedEdge,
  markerId: string,
  side: "start" | "end",
  index: number,
  anchor: PointPx,
  refX: number,
  refY: number,
  angle: number
): ParsedGenericShape[] {
  const fallbackStyle = {
    fill: undefined,
    stroke: edge.style.stroke,
    strokeWidthPx: edge.style.strokeWidthPx,
    dashPattern: edge.style.dashPattern,
  } satisfies ShapeStyle;
  const resolvedStyle = mergeShapeStyles([resolveShapeStyle($, cssRules, child), fallbackStyle]) ?? fallbackStyle;
  const baseId = `${edge.id}-${side}-${markerId}-${index + 1}`;

  if (child.tagName === "circle" || child.tagName === "ellipse") {
    const cx = parseNumber($(child).attr("cx")) ?? 0;
    const cy = parseNumber($(child).attr("cy")) ?? 0;
    const rx = child.tagName === "circle"
      ? parseNumber($(child).attr("r")) ?? 0
      : parseNumber($(child).attr("rx")) ?? 0;
    const ry = child.tagName === "circle"
      ? parseNumber($(child).attr("r")) ?? 0
      : parseNumber($(child).attr("ry")) ?? 0;
    const center = rotateRelativePoint({ x: cx, y: cy }, refX, refY, anchor, angle);

    return [{
      id: baseId,
      kind: "ellipse",
      x: center.x - rx,
      y: center.y - ry,
      width: rx * 2,
      height: ry * 2,
      style: resolvedStyle,
      closed: true,
    }];
  }

  if (child.tagName === "path") {
    const geometry = parseSvgPathData($(child).attr("d"));
    if (!geometry) {
      return [];
    }

    const transformed = transformPathGeometry(geometry, refX, refY, anchor, angle);
    const closed = transformed.commands.some((command) => command.type === "close") || Boolean(resolvedStyle.fill);
    return [{
      id: baseId,
      kind: "customGeometry",
      x: transformed.bounds.x,
      y: transformed.bounds.y,
      width: transformed.bounds.width,
      height: transformed.bounds.height,
      geometry: transformed,
      style: closed ? resolvedStyle : {
        ...resolvedStyle,
        fill: undefined,
      },
      closed,
    }];
  }

  return [];
}

function transformPathGeometry(
  geometry: ParsedPathGeometry,
  refX: number,
  refY: number,
  anchor: PointPx,
  angle: number
): ParsedPathGeometry {
  const commands = geometry.commands.map((command) => {
    switch (command.type) {
      case "moveTo":
      case "lineTo": {
        const point = rotateRelativePoint({ x: command.x, y: command.y }, refX, refY, anchor, angle);
        return { ...command, x: point.x, y: point.y };
      }
      case "quadraticTo": {
        const control = rotateRelativePoint({ x: command.x1, y: command.y1 }, refX, refY, anchor, angle);
        const point = rotateRelativePoint({ x: command.x, y: command.y }, refX, refY, anchor, angle);
        return { ...command, x1: control.x, y1: control.y, x: point.x, y: point.y };
      }
      case "cubicTo": {
        const control1 = rotateRelativePoint({ x: command.x1, y: command.y1 }, refX, refY, anchor, angle);
        const control2 = rotateRelativePoint({ x: command.x2, y: command.y2 }, refX, refY, anchor, angle);
        const point = rotateRelativePoint({ x: command.x, y: command.y }, refX, refY, anchor, angle);
        return {
          ...command,
          x1: control1.x,
          y1: control1.y,
          x2: control2.x,
          y2: control2.y,
          x: point.x,
          y: point.y,
        };
      }
      case "close":
        return command;
    }
  });
  const bounds = getCommandBounds(commands);

  return {
    bounds,
    commands,
    hasCurves: geometry.hasCurves,
  };
}

function rotateRelativePoint(point: PointPx, refX: number, refY: number, anchor: PointPx, angle: number): PointPx {
  const dx = point.x - refX;
  const dy = point.y - refY;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return {
    x: anchor.x + dx * cos - dy * sin,
    y: anchor.y + dx * sin + dy * cos,
  };
}

function getCommandBounds(commands: ParsedPathGeometry["commands"]): BoundingBox {
  const sampledPoints: PointPx[] = [];

  for (const command of commands) {
    switch (command.type) {
      case "moveTo":
      case "lineTo":
        sampledPoints.push({ x: command.x, y: command.y });
        break;
      case "quadraticTo":
        sampledPoints.push({ x: command.x1, y: command.y1 }, { x: command.x, y: command.y });
        break;
      case "cubicTo":
        sampledPoints.push(
          { x: command.x1, y: command.y1 },
          { x: command.x2, y: command.y2 },
          { x: command.x, y: command.y }
        );
        break;
      case "close":
        break;
    }
  }

  return unionBoundingBoxes(
    sampledPoints.map((point) => ({
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
    }))
  ) ?? {
    x: 0,
    y: 0,
    width: 0.5,
    height: 0.5,
  };
}

function parseFloatingTexts($: ReturnType<typeof load>, cssRules: CssRule[], consumed: Set<Element>): ParsedText[] {
  const floatingTexts: ParsedText[] = [];
  const seen = new Set<string>();

  for (const groupedText of parseGroupedFloatingTexts($, cssRules, consumed)) {
    pushUniqueText(floatingTexts, seen, groupedText);
  }

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

function parseGroupedFloatingTexts(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  consumed: Set<Element>
): ParsedText[] {
  const groupedTexts: ParsedText[] = [];

  $("g[data-et='note']").each((_, element) => {
    if (!isElement(element)) {
      return;
    }

    const parsed = parseGroupedNoteText($, cssRules, element, consumed);
    if (parsed) {
      groupedTexts.push(parsed);
    }
  });

  return groupedTexts;
}

function parseGroupedNoteText(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  noteElement: Element,
  consumed: Set<Element>
): ParsedText | undefined {
  const lineEntries = $(noteElement)
    .children("text")
    .toArray()
    .filter(isElement)
    .filter((element) => !consumed.has(element))
    .map((element) => ({
      element,
      parsed: parseTextElement($, cssRules, element, "free", new Set<Element>()),
    }))
    .filter((entry): entry is { element: Element; parsed: ParsedText } => Boolean(entry.parsed))
    .sort((left, right) => left.parsed.y - right.parsed.y);

  if (lineEntries.length === 0) {
    return undefined;
  }

  for (const entry of lineEntries) {
    consumed.add(entry.element);
  }

  const noteRect = $(noteElement).children("rect").first()[0];
  const noteBounds = noteRect && isElement(noteRect) ? getBoundingBoxFromRect($, noteRect) : undefined;
  const mergedText = lineEntries.map((entry) => entry.parsed.text).join("\n");
  const mergedBounds = unionBoundingBoxes(
    lineEntries.map((entry) => ({
      x: entry.parsed.x,
      y: entry.parsed.y,
      width: entry.parsed.width,
      height: entry.parsed.height,
    }))
  );
  const bounds = noteBounds ?? mergedBounds;
  if (!bounds) {
    return undefined;
  }

  return {
    role: "free",
    text: mergedText,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    style: lineEntries[0].parsed.style,
  };
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
  const text = extractForeignObjectText($, element);
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

function extractForeignObjectText($: ReturnType<typeof load>, element: Element): string {
  const buffer: string[] = [];

  for (const child of element.children) {
    appendHtmlText($, child, buffer);
  }

  return normalizeMultilineText(buffer.join(""));
}

function appendHtmlText($: ReturnType<typeof load>, node: AnyNode, buffer: string[]): void {
  if (node.type === "text") {
    buffer.push(node.data);
    return;
  }

  if (!isElement(node)) {
    return;
  }

  if (node.tagName === "br") {
    buffer.push("\n");
    return;
  }

  for (const child of node.children) {
    appendHtmlText($, child, buffer);
  }

  if (isBlockTextElement(node.tagName)) {
    buffer.push("\n");
  }
}

function normalizeMultilineText(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter((line, index, lines) => line.length > 0 || (index > 0 && index < lines.length - 1))
    .join("\n")
    .trim();
}

function isBlockTextElement(tagName: string): boolean {
  return tagName === "div" || tagName === "p" || tagName === "li";
}

function parseTextElement(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  element: Element,
  role: ParsedText["role"],
  consumed: Set<Element>
): ParsedText | undefined {
  const textLines = extractTextLines($, element);
  if (textLines.length === 0) {
    return undefined;
  }
  const text = textLines.join("\n");
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

function extractTextLines($: ReturnType<typeof load>, element: Element): string[] {
  const tspanLines = $(element)
    .children("tspan")
    .toArray()
    .filter(isElement)
    .map((child) => normalizeWhitespace($(child).text()))
    .filter(Boolean);

  if (tspanLines.length > 0) {
    return tspanLines;
  }

  const text = normalizeWhitespace($(element).text());
  return text ? [text] : [];
}

function hasLabelContainerClass($: ReturnType<typeof load>, element: Element): boolean {
  const classes = ($(element).attr("class") ?? "").split(/\s+/).filter(Boolean);
  return classes.includes("label-container");
}

function hasRoundedOuterPathClass($: ReturnType<typeof load>, element: Element): boolean {
  const classes = ($(element).attr("class") ?? "").split(/\s+/).filter(Boolean);
  return classes.includes("label-container") && classes.includes("outer-path");
}

function hasActorParticipantRectClass($: ReturnType<typeof load>, element: Element): boolean {
  const classes = ($(element).attr("class") ?? "").split(/\s+/).filter(Boolean);
  return classes.includes("actor") && (classes.includes("actor-top") || classes.includes("actor-bottom"));
}

function hasActorParticipantTextClass($: ReturnType<typeof load>, element: Element): boolean {
  const classes = ($(element).attr("class") ?? "").split(/\s+/).filter(Boolean);
  return classes.includes("actor") || classes.includes("actor-box") || classes.includes("actor-man");
}

function hasOuterPathGroupClass($: ReturnType<typeof load>, element: Element): boolean {
  const classes = ($(element).attr("class") ?? "").split(/\s+/).filter(Boolean);
  return classes.includes("outer-path") || hasRoundedOuterPathClass($, element);
}

function classifyPolygonKind(points: { x: number; y: number }[]): ParsedNode["kind"] {
  if (isHexagonPolygon(points)) {
    return "hexagon";
  }

  return isDiamondPolygon(points) ? "diamond" : "customGeometry";
}

function classifyPresetPolygonKind(points: { x: number; y: number }[]): ParsedNode["kind"] | undefined {
  const quadrilateralKind = classifyPresetQuadrilateralKind(points);
  if (quadrilateralKind) {
    return quadrilateralKind;
  }

  if (isFlowChartPredefinedProcessPolygon(points)) {
    return "flowChartPredefinedProcess";
  }

  if (isHexagonPolygon(points)) {
    return "hexagon";
  }

  if (points.length === 4 && isDiamondPolygon(points)) {
    return "diamond";
  }

  return undefined;
}

function classifyPresetQuadrilateralKind(points: { x: number; y: number }[]): ParsedNode["kind"] | undefined {
  if (isFlowChartManualOperationPolygon(points)) {
    return "flowChartManualOperation";
  }

  if (isFlowChartInputOutputPolygon(points)) {
    return "flowChartInputOutput";
  }

  return undefined;
}

function isFlowChartInputOutputPolygon(points: { x: number; y: number }[]): boolean {
  const corners = getQuadrilateralCorners(points);
  if (!corners || isDiamondPolygon(points)) {
    return false;
  }

  const leftTilt = corners.topLeft.x - corners.bottomLeft.x;
  const rightTilt = corners.topRight.x - corners.bottomRight.x;
  const topWidth = corners.topRight.x - corners.topLeft.x;
  const bottomWidth = corners.bottomRight.x - corners.bottomLeft.x;

  return (
    leftTilt * rightTilt > 0 &&
    Math.abs(Math.abs(leftTilt) - Math.abs(rightTilt)) <= 2.5 &&
    Math.abs(topWidth - bottomWidth) <= Math.max(6, Math.max(topWidth, bottomWidth) * 0.2)
  );
}

function isFlowChartManualOperationPolygon(points: { x: number; y: number }[]): boolean {
  const corners = getQuadrilateralCorners(points);
  if (!corners || isDiamondPolygon(points)) {
    return false;
  }

  const leftTilt = corners.topLeft.x - corners.bottomLeft.x;
  const rightTilt = corners.topRight.x - corners.bottomRight.x;
  const topWidth = corners.topRight.x - corners.topLeft.x;
  const bottomWidth = corners.bottomRight.x - corners.bottomLeft.x;

  return leftTilt * rightTilt < 0 && Math.abs(topWidth - bottomWidth) >= 6;
}

function getQuadrilateralCorners(points: { x: number; y: number }[]): {
  topLeft: PointPx;
  topRight: PointPx;
  bottomLeft: PointPx;
  bottomRight: PointPx;
} | undefined {
  if (points.length !== 4) {
    return undefined;
  }

  const ys = points.map((point) => point.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const topPoints = points
    .filter((point) => nearlyEquals(point.y, minY))
    .sort((left, right) => left.x - right.x);
  const bottomPoints = points
    .filter((point) => nearlyEquals(point.y, maxY))
    .sort((left, right) => left.x - right.x);

  if (topPoints.length !== 2 || bottomPoints.length !== 2) {
    return undefined;
  }

  return {
    topLeft: topPoints[0],
    topRight: topPoints[1],
    bottomLeft: bottomPoints[0],
    bottomRight: bottomPoints[1],
  };
}

function isFlowChartPredefinedProcessPolygon(points: { x: number; y: number }[]): boolean {
  if (points.length < 8) {
    return false;
  }

  const distinctXs = countDistinctValues(points.map((point) => point.x));
  const distinctYs = countDistinctValues(points.map((point) => point.y));

  return distinctXs === 4 && distinctYs === 2;
}

function isHexagonPolygon(points: { x: number; y: number }[]): boolean {
  if (points.length !== 6) {
    return false;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const topCount = points.filter((point) => nearlyEquals(point.y, minY)).length;
  const bottomCount = points.filter((point) => nearlyEquals(point.y, maxY)).length;
  const leftCount = points.filter((point) => nearlyEquals(point.x, minX)).length;
  const rightCount = points.filter((point) => nearlyEquals(point.x, maxX)).length;

  return topCount === 2 && bottomCount === 2 && leftCount === 1 && rightCount === 1;
}

function isDiamondPolygon(points: { x: number; y: number }[]): boolean {
  if (points.length !== 4) {
    return false;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const topCount = points.filter((point) => nearlyEquals(point.y, minY)).length;
  const bottomCount = points.filter((point) => nearlyEquals(point.y, maxY)).length;
  const leftCount = points.filter((point) => nearlyEquals(point.x, minX)).length;
  const rightCount = points.filter((point) => nearlyEquals(point.x, maxX)).length;

  return topCount === 1 && bottomCount === 1 && leftCount === 1 && rightCount === 1;
}

function classifyPathLikeNodeKind(
  $: ReturnType<typeof load>,
  element: Element,
  geometry: ParsedPathGeometry,
  rawPathData: string[]
): ParsedNode["kind"] {
  if (isFlowChartMagneticDiskPath(rawPathData)) {
    return "flowChartMagneticDisk";
  }

  if (isFlowChartInternalStoragePath(geometry, rawPathData)) {
    return "flowChartInternalStorage";
  }

  if (isFlowChartManualInputPath(geometry)) {
    return "flowChartManualInput";
  }

  if (isFlowChartDocumentPath(geometry)) {
    return "flowChartDocument";
  }

  if (isFlowChartDisplayPath(geometry)) {
    return "flowChartDisplay";
  }

  if (isRoundedOuterPathNode($, element, geometry, rawPathData)) {
    return "roundRect";
  }

  return classifyPathNodeKind(geometry);
}

function classifyPathNodeKind(geometry: ParsedPathGeometry): ParsedNode["kind"] {
  if (isLikelyEllipseGeometry(geometry)) {
    return "ellipse";
  }

  if (isLikelyRectGeometry(geometry)) {
    return geometry.hasCurves ? "roundRect" : "rect";
  }

  return "customGeometry";
}

function isFlowChartMagneticDiskPath(rawPathData: string[]): boolean {
  if (rawPathData.length === 0) {
    return false;
  }

  return rawPathData.some((pathData) => /[aA]/.test(pathData));
}

function isRoundedOuterPathNode(
  $: ReturnType<typeof load>,
  element: Element,
  geometry: ParsedPathGeometry,
  rawPathData: string[]
): boolean {
  const classes = ($(element).attr("class") ?? "").split(/\s+/).filter(Boolean);
  const hasOuterPath = classes.includes("outer-path");
  if (!hasOuterPath) {
    return false;
  }

  if (rawPathData.some((pathData) => /[aA]/.test(pathData))) {
    return false;
  }

  const cubicCommandCount = rawPathData.reduce((count, pathData) => {
    const matches = pathData.match(/[cC]/g);
    return count + (matches?.length ?? 0);
  }, 0);

  return geometry.bounds.width > geometry.bounds.height && geometry.commands.length >= 20 && cubicCommandCount >= 20;
}

function isFlowChartInternalStoragePath(geometry: ParsedPathGeometry, rawPathData: string[]): boolean {
  if (!isLikelyRectGeometry(geometry) || geometry.hasCurves || rawPathData.length < 2) {
    return false;
  }

  const localBounds = unionBoundingBoxes(
    rawPathData
      .map((pathData) => parseSvgPathData(pathData)?.bounds)
      .filter((bounds): bounds is BoundingBox => Boolean(bounds))
  );
  if (!localBounds) {
    return false;
  }

  return rawPathData.some((pathData) => hasInteriorPathEndpoint(pathData, localBounds));
}

function hasInteriorPathEndpoint(pathData: string, bounds: BoundingBox): boolean {
  const commands = parseSvgPathData(pathData)?.commands ?? [];
  const inset = Math.max(1.5, Math.min(bounds.width, bounds.height) * 0.06);

  return commands.some((command) => {
    if (command.type === "close") {
      return false;
    }

    const insideX = command.x > bounds.x + inset && command.x < bounds.x + bounds.width - inset;
    const insideY = command.y > bounds.y + inset && command.y < bounds.y + bounds.height - inset;
    const withinX = command.x >= bounds.x - inset && command.x <= bounds.x + bounds.width + inset;
    const withinY = command.y >= bounds.y - inset && command.y <= bounds.y + bounds.height + inset;

    return (insideX && withinY) || (insideY && withinX);
  });
}

function isFlowChartManualInputPath(geometry: ParsedPathGeometry): boolean {
  const endpoints = getGeometryEndpoints(geometry);
  if (endpoints.length !== 5) {
    return false;
  }

  const minX = geometry.bounds.x;
  const maxX = geometry.bounds.x + geometry.bounds.width;
  const minY = geometry.bounds.y;
  const maxY = geometry.bounds.y + geometry.bounds.height;
  const xTolerance = Math.max(2, geometry.bounds.width * 0.08);
  const yTolerance = Math.max(2, geometry.bounds.height * 0.08);

  return (
    isNear(endpoints[1].x, minX, xTolerance) &&
    isNear(endpoints[1].y, maxY, yTolerance) &&
    isNear(endpoints[2].x, maxX, xTolerance) &&
    isNear(endpoints[2].y, maxY, yTolerance) &&
    isNear(endpoints[3].x, maxX, xTolerance) &&
    isNear(endpoints[3].y, minY, yTolerance) &&
    isNear(endpoints[4].x, minX, xTolerance) &&
    endpoints[4].y > minY + geometry.bounds.height * 0.2 &&
    endpoints[4].y < maxY - geometry.bounds.height * 0.15
  );
}

function isFlowChartDocumentPath(geometry: ParsedPathGeometry): boolean {
  const endpoints = getGeometryEndpoints(geometry);
  if (endpoints.length < 20) {
    return false;
  }

  const minX = geometry.bounds.x;
  const maxX = geometry.bounds.x + geometry.bounds.width;
  const minY = geometry.bounds.y;
  const maxY = geometry.bounds.y + geometry.bounds.height;
  const xTolerance = Math.max(2, geometry.bounds.width * 0.08);
  const yTolerance = Math.max(2, geometry.bounds.height * 0.12);
  const bottomBandY = minY + geometry.bounds.height * 0.78;
  const firstRun = endpoints.slice(0, Math.min(14, endpoints.length));
  const bottomRunCount = firstRun.filter((point) => point.y >= bottomBandY).length;

  return (
    bottomRunCount >= 10 &&
    endpoints.some((point) => isNear(point.x, minX, xTolerance) && isNear(point.y, minY, yTolerance)) &&
    endpoints.some((point) => isNear(point.x, maxX, xTolerance) && isNear(point.y, minY, yTolerance))
  );
}

function isFlowChartDisplayPath(geometry: ParsedPathGeometry): boolean {
  const endpoints = getGeometryEndpoints(geometry);
  if (endpoints.length < 20) {
    return false;
  }

  const minX = geometry.bounds.x;
  const maxX = geometry.bounds.x + geometry.bounds.width;
  const minY = geometry.bounds.y;
  const maxY = geometry.bounds.y + geometry.bounds.height;
  const midY = minY + geometry.bounds.height / 2;
  const xTolerance = Math.max(2, geometry.bounds.width * 0.08);
  const yTolerance = Math.max(2, geometry.bounds.height * 0.12);
  const [start, second, third, fourth, fifth] = endpoints;

  if (!start || !second || !third || !fourth || !fifth) {
    return false;
  }

  return (
    start.x >= minX + geometry.bounds.width * 0.6 &&
    isNear(start.y, minY, yTolerance) &&
    second.x <= minX + geometry.bounds.width * 0.25 &&
    isNear(second.y, minY, yTolerance) &&
    isNear(third.x, minX, xTolerance) &&
    isNear(third.y, midY, geometry.bounds.height * 0.12) &&
    fourth.x <= minX + geometry.bounds.width * 0.25 &&
    isNear(fourth.y, maxY, yTolerance) &&
    fifth.x >= minX + geometry.bounds.width * 0.6 &&
    isNear(fifth.y, maxY, yTolerance)
  );
}

function getGeometryEndpoints(geometry: ParsedPathGeometry): PointPx[] {
  return geometry.commands.flatMap((command) => {
    if (command.type === "close") {
      return [];
    }

    return [{ x: command.x, y: command.y }];
  });
}

function isNear(value: number, target: number, tolerance: number): boolean {
  return Math.abs(value - target) <= tolerance;
}

function isLikelyEllipseGeometry(geometry: ParsedPathGeometry): boolean {
  const ratio = geometry.bounds.width / Math.max(geometry.bounds.height, 0.001);
  const onlyCurves = geometry.commands.every((command) =>
    command.type === "moveTo" ||
    command.type === "quadraticTo" ||
    command.type === "cubicTo" ||
    command.type === "close"
  );

  return onlyCurves && ratio >= 0.75 && ratio <= 1.33;
}

function isLikelyRectGeometry(geometry: ParsedPathGeometry): boolean {
  const points = geometryToPoints(geometry);
  if (points.length < 4) {
    return false;
  }

  return points.every((point) =>
    nearlyEquals(point.x, geometry.bounds.x) ||
    nearlyEquals(point.x, geometry.bounds.x + geometry.bounds.width) ||
    nearlyEquals(point.y, geometry.bounds.y) ||
    nearlyEquals(point.y, geometry.bounds.y + geometry.bounds.height)
  );
}

function nearlyEquals(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.75;
}

function countDistinctValues(values: number[]): number {
  const distinct: number[] = [];

  for (const value of values) {
    if (!distinct.some((candidate) => nearlyEquals(candidate, value))) {
      distinct.push(value);
    }
  }

  return distinct.length;
}

function mergePathGeometries(geometries: ParsedPathGeometry[]): ParsedPathGeometry {
  const bounds = unionBoundingBoxes(geometries.map((geometry) => geometry.bounds)) ?? {
    x: 0,
    y: 0,
    width: 0.5,
    height: 0.5,
  };

  return {
    bounds,
    commands: geometries.flatMap((geometry) => geometry.commands),
    hasCurves: geometries.some((geometry) => geometry.hasCurves),
  };
}

function ellipseBoundsToGeometry(bounds: BoundingBox): ParsedPathGeometry {
  const rx = bounds.width / 2;
  const ry = bounds.height / 2;
  const cx = bounds.x + rx;
  const cy = bounds.y + ry;
  const kappa = 0.5522847498307936;
  const ox = rx * kappa;
  const oy = ry * kappa;

  return {
    bounds,
    hasCurves: true,
    commands: [
      { type: "moveTo", x: cx + rx, y: cy },
      { type: "cubicTo", x1: cx + rx, y1: cy + oy, x2: cx + ox, y2: cy + ry, x: cx, y: cy + ry },
      { type: "cubicTo", x1: cx - ox, y1: cy + ry, x2: cx - rx, y2: cy + oy, x: cx - rx, y: cy },
      { type: "cubicTo", x1: cx - rx, y1: cy - oy, x2: cx - ox, y2: cy - ry, x: cx, y: cy - ry },
      { type: "cubicTo", x1: cx + ox, y1: cy - ry, x2: cx + rx, y2: cy - oy, x: cx + rx, y: cy },
      { type: "close" },
    ],
  };
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
        startArrow: parseMarkerArrowType($(element).attr("marker-start")),
        endArrow: parseMarkerArrowType($(element).attr("marker-end")),
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
        startArrow: parseMarkerArrowType($(element).attr("marker-start")),
        endArrow: parseMarkerArrowType($(element).attr("marker-end")),
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
          startArrow: parseMarkerArrowType($(element).attr("marker-start")),
          endArrow: parseMarkerArrowType($(element).attr("marker-end")),
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
        startArrow: parseMarkerArrowType($(element).attr("marker-start")),
        endArrow: parseMarkerArrowType($(element).attr("marker-end")),
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

function parseMarkerArrowType(markerReference: string | undefined): LineArrowType | undefined {
  if (!markerReference) {
    return undefined;
  }

  const markerId = extractMarkerId(markerReference)?.toLowerCase();
  if (!markerId) {
    return undefined;
  }

  if (isDecoratedMarker(markerId)) {
    return undefined;
  }

  if (markerId.includes("composition") || markerId.includes("aggregation")) {
    return "diamond";
  }

  if (markerId.includes("lollipop") || markerId.includes("circle") || markerId.includes("oval")) {
    return "oval";
  }

  if (markerId.includes("dependency")) {
    return "stealth";
  }

  if (
    markerId.includes("arrow") ||
    markerId.includes("point") ||
    markerId.includes("stick") ||
    markerId.includes("cross")
  ) {
    return "arrow";
  }

  if (
    markerId.includes("extension") ||
    markerId.includes("triangle") ||
    markerId.includes("filled") ||
    markerId.includes("head")
  ) {
    return "triangle";
  }

  return "triangle";
}

function isDecoratedMarker(markerId: string): boolean {
  return (
    markerId.includes("_er-") ||
    markerId.includes("er-") ||
    markerId.includes("composition") ||
    markerId.includes("aggregation") ||
    markerId.includes("lollipop") ||
    markerId.includes("extension")
  );
}

function extractMarkerId(markerReference: string | undefined): string | undefined {
  if (!markerReference) {
    return undefined;
  }

  const urlMatch = markerReference.match(/url\(\s*#([^)]+)\s*\)/i);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  return markerReference.replace(/^#/, "").trim();
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
