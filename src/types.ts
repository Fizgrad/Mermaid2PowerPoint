export interface PointPx {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface ColorValue {
  hex: string;
  transparency: number;
}

export interface ShapeStyle {
  fill?: ColorValue;
  stroke?: ColorValue;
  strokeWidthPx?: number;
  dashPattern?: "solid" | "dash" | "dot";
}

export interface TextStyle {
  color?: ColorValue;
  fontFamily?: string;
  fontSizePx?: number;
  align?: "left" | "center" | "right";
}

export interface PathMoveTo {
  type: "moveTo";
  x: number;
  y: number;
}

export interface PathLineTo {
  type: "lineTo";
  x: number;
  y: number;
}

export interface PathQuadraticTo {
  type: "quadraticTo";
  x1: number;
  y1: number;
  x: number;
  y: number;
}

export interface PathCubicTo {
  type: "cubicTo";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x: number;
  y: number;
}

export interface PathClose {
  type: "close";
}

export type PathCommandPx =
  | PathMoveTo
  | PathLineTo
  | PathQuadraticTo
  | PathCubicTo
  | PathClose;

export interface ParsedPathGeometry {
  bounds: BoundingBox;
  commands: PathCommandPx[];
  hasCurves: boolean;
}

export interface ParsedText {
  id?: string;
  role: "node" | "edge" | "free";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: TextStyle;
  boxStyle?: ShapeStyle;
}

export interface ParsedNode {
  id: string;
  kind: "rect" | "roundRect" | "ellipse" | "diamond" | "hexagon";
  x: number;
  y: number;
  width: number;
  height: number;
  style: ShapeStyle;
  text?: ParsedText;
}

export interface ParsedCluster {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: ShapeStyle;
  label?: ParsedText;
}

export interface ParsedImageNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  href: string;
  preserveAspectRatio?: string;
  frameStyle?: ShapeStyle;
  label?: ParsedText;
}

export type LineArrowType = "arrow" | "diamond" | "oval" | "stealth" | "triangle";

export interface ParsedGenericShape {
  id: string;
  kind: "rect" | "roundRect" | "ellipse" | "diamond" | "hexagon" | "line" | "customGeometry";
  x: number;
  y: number;
  width: number;
  height: number;
  style: ShapeStyle;
  geometry?: ParsedPathGeometry;
  points?: PointPx[];
  startArrow?: LineArrowType;
  endArrow?: LineArrowType;
  closed?: boolean;
}

export interface ParsedEdge {
  id: string;
  points: PointPx[];
  geometry?: ParsedPathGeometry;
  style: ShapeStyle;
  startArrow?: LineArrowType;
  endArrow?: LineArrowType;
  startMarkerId?: string;
  endMarkerId?: string;
  label?: ParsedText;
}

export interface ParsedDiagram {
  viewBox: ViewBox;
  background?: ColorValue;
  clusters: ParsedCluster[];
  nodes: ParsedNode[];
  imageNodes: ParsedImageNode[];
  genericShapes: ParsedGenericShape[];
  markerDecorations: ParsedGenericShape[];
  edges: ParsedEdge[];
  floatingTexts: ParsedText[];
}

export interface ConvertSvgToPptxOptions {
  slidePaddingPx?: number;
  title?: string;
  author?: string;
  company?: string;
}

export interface ExportPptxOptions {
  render?: MermaidRenderOptions;
  convert?: ConvertSvgToPptxOptions;
}

export interface MermaidRenderOptions {
  theme?: string;
  background?: string;
  scale?: number;
  mmdcPath?: string;
  noSandbox?: boolean;
  puppeteerConfigFile?: string;
}
