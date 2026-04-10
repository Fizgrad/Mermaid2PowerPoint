import { load } from "cheerio";
import type { AnyNode, Element } from "domhandler";

import { geometryToPoints, parseSvgPathData, unionBoundingBoxes } from "./svgPath.js";
import type {
  BoundingBox,
  ColorValue,
  ParsedCluster,
  ParsedDiagram,
  ParsedEdge,
  ParsedImageNode,
  ParsedNode,
  ParsedPathGeometry,
  ParsedText,
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
  const edgeLabelMap = buildEdgeLabelMap($, cssRules);
  const clusters = parseClusters($, cssRules);
  const nodes = parseNodes($, cssRules);
  const imageNodes = parseImageNodes($, cssRules);
  const edges = parseEdges($, cssRules, edgeLabelMap);
  const floatingTexts = parseFloatingTexts($, cssRules);

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

function parseClusters($: ReturnType<typeof load>, cssRules: CssRule[]): ParsedCluster[] {
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
      ? parseLabelText($, cssRules, labelElement, "free")
      : undefined;

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

function parseNodes($: ReturnType<typeof load>, cssRules: CssRule[]): ParsedNode[] {
  const nodes: ParsedNode[] = [];

  $("g.node").each((_, element) => {
    const shape = parseNodeShape($, cssRules, element);
    if (!shape) {
      return;
    }

    const id = $(element).attr("id") ?? `node-${nodes.length + 1}`;
    const text = parseLabelText($, cssRules, element, "node");

    nodes.push({
      id,
      kind: shape.kind,
      x: shape.bounds.x,
      y: shape.bounds.y,
      width: shape.bounds.width,
      height: shape.bounds.height,
      style: resolveShapeStyle($, cssRules, shape.styleElement),
      text,
    });
  });

  return nodes;
}

function parseImageNodes($: ReturnType<typeof load>, cssRules: CssRule[]): ParsedImageNode[] {
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
      ? parseLabelText($, cssRules, labelElement, "node")
      : undefined;
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
        };
      }
    }
  }

  for (const child of directChildren) {
    if (child.tagName !== "g" || !hasRoundedOuterPathClass($, child)) {
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
      const styleElement = pathChildren.find((pathChild) => hasRenderableShapeStyle($, cssRules, pathChild)) ?? child;
      return {
        kind: "roundRect",
        bounds,
        styleElement,
      };
    }
  }

  return undefined;
}

function parseEdges(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  edgeLabelMap: Map<string, ParsedText>
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

function parseFloatingTexts($: ReturnType<typeof load>, cssRules: CssRule[]): ParsedText[] {
  const floatingTexts: ParsedText[] = [];

  $("svg > text, .cluster-label text, .flowchartTitleText").each((_, element) => {
    const text = parseTextElement($, cssRules, element, "free");
    if (text) {
      floatingTexts.push(text);
    }
  });

  return floatingTexts;
}

function buildEdgeLabelMap($: ReturnType<typeof load>, cssRules: CssRule[]): Map<string, ParsedText> {
  const labels = new Map<string, ParsedText>();

  $(".edgeLabels .label[data-id]").each((_, element) => {
    const id = $(element).attr("data-id");
    if (!id) {
      return;
    }

    const parsed = parseLabelText($, cssRules, element, "edge");
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
  role: ParsedText["role"]
): ParsedText | undefined {
  const foreignObject = $(container).find("foreignObject").first()[0];
  if (foreignObject) {
    return parseForeignObjectText($, cssRules, foreignObject, role);
  }

  const textElement = $(container).find("text").first()[0];
  if (textElement) {
    return parseTextElement($, cssRules, textElement, role);
  }

  return undefined;
}

function parseForeignObjectText(
  $: ReturnType<typeof load>,
  cssRules: CssRule[],
  element: Element,
  role: ParsedText["role"]
): ParsedText | undefined {
  const text = normalizeWhitespace($(element).text());
  if (!text) {
    return undefined;
  }

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
  role: ParsedText["role"]
): ParsedText | undefined {
  const text = normalizeWhitespace($(element).text());
  if (!text) {
    return undefined;
  }

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

function classifyPolygonKind(points: { x: number; y: number }[]): ParsedNode["kind"] {
  if (points.length >= 6) {
    return "hexagon";
  }

  return "diamond";
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
  const candidateStyles = $(container)
    .find("path")
    .toArray()
    .filter(isElement)
    .filter((pathElement) => !$(pathElement).closest(".label").length);
  const styles = candidateStyles
    .map((pathElement) => resolveShapeStyle($, cssRules, pathElement))
    .filter((style) => Boolean(style.fill || style.stroke));

  if (styles.length === 0) {
    return undefined;
  }

  return styles.reduce<ShapeStyle>((merged, current) => ({
    fill: merged.fill ?? current.fill,
    stroke: merged.stroke ?? current.stroke,
    strokeWidthPx: merged.strokeWidthPx ?? current.strokeWidthPx,
    dashPattern: merged.dashPattern ?? current.dashPattern,
  }), {});
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

  for (const rule of cssRules) {
    for (const selector of rule.selectors) {
      try {
        if ($(element).is(selector)) {
          Object.assign(resolved, rule.declarations);
          break;
        }
      } catch {
        continue;
      }
    }
  }

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

  Object.assign(resolved, parseInlineStyle($(element).attr("style")));

  return resolved;
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
