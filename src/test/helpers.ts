import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

import { renderMermaidFileToSvg } from "../mermaidCliRenderer.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../..");
const sampleMermaidPath = join(repoRoot, "examples", "simple-flow.mmd");

let sampleSvgPromise: Promise<string> | undefined;

export function getRepoRoot(): string {
  return repoRoot;
}

export function getSampleMermaidPath(): string {
  return sampleMermaidPath;
}

export function getSampleSvg(): Promise<string> {
  sampleSvgPromise ??= renderMermaidFileToSvg(sampleMermaidPath, {
    noSandbox: true,
  });
  return sampleSvgPromise;
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
