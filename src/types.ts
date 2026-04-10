export interface PointPx {
  x: number;
  y: number;
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

export interface ParsedText {
  id?: string;
  role: "node" | "edge" | "free";
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: TextStyle;
}

export interface ParsedNode {
  id: string;
  kind: "rect" | "diamond";
  x: number;
  y: number;
  width: number;
  height: number;
  style: ShapeStyle;
  text?: ParsedText;
}

export interface ParsedEdge {
  id: string;
  points: PointPx[];
  style: ShapeStyle;
  startArrow?: "triangle";
  endArrow?: "triangle";
  label?: ParsedText;
}

export interface ParsedDiagram {
  viewBox: ViewBox;
  background?: ColorValue;
  nodes: ParsedNode[];
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
