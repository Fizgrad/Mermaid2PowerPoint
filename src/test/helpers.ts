import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

import { renderMermaidFileToSvg } from "../mermaidCliRenderer.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../..");
const sampleMermaidPath = join(repoRoot, "examples", "simple-flow.mmd");
const shapeRegressionPath = join(repoRoot, "examples", "shape-regression.mmd");
const flowchartSpecialShapesPath = join(repoRoot, "examples", "flowchart-special-shapes.mmd");
const flowchartPresetNodesPath = join(repoRoot, "examples", "flowchart-preset-nodes.mmd");
const styledLinksPath = join(repoRoot, "examples", "styled-links.mmd");
const curvedBasisPath = join(repoRoot, "examples", "curved-basis.mmd");
const clusterRegressionPath = join(repoRoot, "examples", "cluster-regression.mmd");
const imageNodePath = join(repoRoot, "examples", "image-node.mmd");
const sequenceBasicPath = join(repoRoot, "examples", "sequence-basic.mmd");
const sequenceNoteBreaksPath = join(repoRoot, "examples", "sequence-note-breaks.mmd");
const stateBasicPath = join(repoRoot, "examples", "state-basic.mmd");
const mindmapBasicPath = join(repoRoot, "examples", "mindmap-basic.mmd");
const erBasicPath = join(repoRoot, "examples", "er-basic.mmd");
const erCardinalityPath = join(repoRoot, "examples", "er-cardinality.mmd");
const ganttBasicPath = join(repoRoot, "examples", "gantt-basic.mmd");
const classRelationsPath = join(repoRoot, "examples", "class-relations.mmd");

const svgCache = new Map<string, Promise<string>>();

export function getRepoRoot(): string {
  return repoRoot;
}

export function getSampleMermaidPath(): string {
  return sampleMermaidPath;
}

export function getSampleSvg(): Promise<string> {
  return getFixtureSvg("simple-flow");
}

export function getFixtureMermaidPath(
  fixtureName:
    | "simple-flow"
    | "shape-regression"
    | "flowchart-special-shapes"
    | "flowchart-preset-nodes"
    | "styled-links"
    | "curved-basis"
    | "cluster-regression"
    | "image-node"
    | "sequence-basic"
    | "sequence-note-breaks"
    | "state-basic"
    | "mindmap-basic"
    | "er-basic"
    | "er-cardinality"
    | "gantt-basic"
    | "class-relations"
): string {
  switch (fixtureName) {
    case "shape-regression":
      return shapeRegressionPath;
    case "flowchart-special-shapes":
      return flowchartSpecialShapesPath;
    case "flowchart-preset-nodes":
      return flowchartPresetNodesPath;
    case "styled-links":
      return styledLinksPath;
    case "curved-basis":
      return curvedBasisPath;
    case "cluster-regression":
      return clusterRegressionPath;
    case "image-node":
      return imageNodePath;
    case "sequence-basic":
      return sequenceBasicPath;
    case "sequence-note-breaks":
      return sequenceNoteBreaksPath;
    case "state-basic":
      return stateBasicPath;
    case "mindmap-basic":
      return mindmapBasicPath;
    case "er-basic":
      return erBasicPath;
    case "er-cardinality":
      return erCardinalityPath;
    case "gantt-basic":
      return ganttBasicPath;
    case "class-relations":
      return classRelationsPath;
    case "simple-flow":
    default:
      return sampleMermaidPath;
  }
}

export function getFixtureSvg(
  fixtureName:
    | "simple-flow"
    | "shape-regression"
    | "flowchart-special-shapes"
    | "flowchart-preset-nodes"
    | "styled-links"
    | "curved-basis"
    | "cluster-regression"
    | "image-node"
    | "sequence-basic"
    | "sequence-note-breaks"
    | "state-basic"
    | "mindmap-basic"
    | "er-basic"
    | "er-cardinality"
    | "gantt-basic"
    | "class-relations"
): Promise<string> {
  const mermaidPath = getFixtureMermaidPath(fixtureName);
  const cached = svgCache.get(mermaidPath);
  if (cached) {
    return cached;
  }

  const promise = renderMermaidFileToSvg(mermaidPath, {
    noSandbox: true,
  });
  svgCache.set(mermaidPath, promise);
  return promise;
}

export async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "mermaid2pptx-test-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

export async function readSlideXml(pptxPath: string): Promise<string> {
  const buffer = await readFile(pptxPath);
  const zip = await JSZip.loadAsync(buffer);
  const slide = zip.file("ppt/slides/slide1.xml");
  if (!slide) {
    throw new Error(`Missing slide1.xml in ${pptxPath}`);
  }

  return slide.async("string");
}
