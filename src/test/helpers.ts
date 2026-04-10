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
const styledLinksPath = join(repoRoot, "examples", "styled-links.mmd");
const curvedBasisPath = join(repoRoot, "examples", "curved-basis.mmd");

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
  fixtureName: "simple-flow" | "shape-regression" | "styled-links" | "curved-basis"
): string {
  switch (fixtureName) {
    case "shape-regression":
      return shapeRegressionPath;
    case "styled-links":
      return styledLinksPath;
    case "curved-basis":
      return curvedBasisPath;
    case "simple-flow":
    default:
      return sampleMermaidPath;
  }
}

export function getFixtureSvg(
  fixtureName: "simple-flow" | "shape-regression" | "styled-links" | "curved-basis"
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
