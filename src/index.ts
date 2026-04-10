import { readFile } from "node:fs/promises";

import { renderMermaidCodeToSvg, renderMermaidFileToSvg } from "./mermaidCliRenderer.js";
import { convertSvgToPptx, convertSvgToPptxBuffer } from "./pptx.js";
import type { ConvertSvgToPptxOptions, ExportPptxOptions, MermaidRenderOptions } from "./types.js";

export { convertSvgToPptx } from "./pptx.js";
export { convertSvgToPptxBuffer } from "./pptx.js";
export { parseMermaidFlowchartSvg, parsePath, parseRect, parseText } from "./parseSvg.js";
export type {
  ConvertSvgToPptxOptions,
  ExportPptxOptions,
  MermaidRenderOptions,
  ParsedDiagram,
  ParsedEdge,
  ParsedNode,
  ParsedText,
} from "./types.js";

export async function convertSvgFileToPptx(
  svgPath: string,
  outputPath: string,
  options: ConvertSvgToPptxOptions = {}
): Promise<void> {
  const svgString = await readFile(svgPath, "utf8");
  await convertSvgToPptx(svgString, outputPath, options);
}

export async function convertMermaidCodeToPptx(
  mermaidCode: string,
  outputPath: string,
  renderOptions: MermaidRenderOptions = {},
  convertOptions: ConvertSvgToPptxOptions = {}
): Promise<void> {
  const svgString = await renderMermaidCodeToSvg(mermaidCode, renderOptions);
  await convertSvgToPptx(svgString, outputPath, convertOptions);
}

export async function convertMermaidFileToPptx(
  mermaidPath: string,
  outputPath: string,
  renderOptions: MermaidRenderOptions = {},
  convertOptions: ConvertSvgToPptxOptions = {}
): Promise<void> {
  const svgString = await renderMermaidFileToSvg(mermaidPath, renderOptions);
  await convertSvgToPptx(svgString, outputPath, convertOptions);
}

export async function convertMermaidCodeToPptxBuffer(
  mermaidCode: string,
  options: ExportPptxOptions = {}
): Promise<Buffer> {
  const svgString = await renderMermaidCodeToSvg(mermaidCode, options.render);
  return convertSvgToPptxBuffer(svgString, options.convert);
}
