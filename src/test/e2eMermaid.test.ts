import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { convertMermaidFileToPptx } from "../index.js";
import { getFixtureMermaidPath, getSampleMermaidPath, readSlideXml, withTempDir } from "./helpers.js";

test("convertMermaidFileToPptx renders Mermaid source and writes editable PPT output", async () => {
  await withTempDir(async (dir) => {
    const outputPath = join(dir, "from-mermaid.pptx");
    await convertMermaidFileToPptx(
      getSampleMermaidPath(),
      outputPath,
      {
        noSandbox: true,
      }
    );

    const slideXml = await readSlideXml(outputPath);
    assert.equal(slideXml.includes("<p:pic>"), false);
    assert.match(slideXml, /<a:prstGeom prst="diamond"/);
    assert.match(slideXml, /<a:t>Check input<\/a:t>/);
  });
});

test("convertMermaidFileToPptx supports richer Mermaid fixtures end to end", async () => {
  await withTempDir(async (dir) => {
    const shapesOutput = join(dir, "shape-regression.pptx");
    const curvedOutput = join(dir, "curved-basis.pptx");
    const clusterOutput = join(dir, "cluster-regression.pptx");
    const imageOutput = join(dir, "image-node.pptx");
    const sequenceOutput = join(dir, "sequence-basic.pptx");
    const mindmapOutput = join(dir, "mindmap-basic.pptx");
    const erOutput = join(dir, "er-basic.pptx");
    const ganttOutput = join(dir, "gantt-basic.pptx");

    await convertMermaidFileToPptx(getFixtureMermaidPath("shape-regression"), shapesOutput, {
      noSandbox: true,
    });
    await convertMermaidFileToPptx(getFixtureMermaidPath("curved-basis"), curvedOutput, {
      noSandbox: true,
    });
    await convertMermaidFileToPptx(getFixtureMermaidPath("cluster-regression"), clusterOutput, {
      noSandbox: true,
    });
    await convertMermaidFileToPptx(getFixtureMermaidPath("image-node"), imageOutput, {
      noSandbox: true,
    });
    await convertMermaidFileToPptx(getFixtureMermaidPath("sequence-basic"), sequenceOutput, {
      noSandbox: true,
    });
    await convertMermaidFileToPptx(getFixtureMermaidPath("mindmap-basic"), mindmapOutput, {
      noSandbox: true,
    });
    await convertMermaidFileToPptx(getFixtureMermaidPath("er-basic"), erOutput, {
      noSandbox: true,
    });
    await convertMermaidFileToPptx(getFixtureMermaidPath("gantt-basic"), ganttOutput, {
      noSandbox: true,
    });

    const shapesSlideXml = await readSlideXml(shapesOutput);
    const curvedSlideXml = await readSlideXml(curvedOutput);
    const clusterSlideXml = await readSlideXml(clusterOutput);
    const imageSlideXml = await readSlideXml(imageOutput);
    const sequenceSlideXml = await readSlideXml(sequenceOutput);
    const mindmapSlideXml = await readSlideXml(mindmapOutput);
    const erSlideXml = await readSlideXml(erOutput);
    const ganttSlideXml = await readSlideXml(ganttOutput);

    assert.match(shapesSlideXml, /<a:prstGeom prst="roundRect"/);
    assert.match(shapesSlideXml, /<a:prstGeom prst="ellipse"/);
    assert.match(curvedSlideXml, /<a:custGeom>/);
    assert.match(clusterSlideXml, /<a:t>API Layer<\/a:t>/);
    assert.match(imageSlideXml, /<p:pic>/);
    assert.match(sequenceSlideXml, /<a:t>Hello Bob<\/a:t>/);
    assert.match(mindmapSlideXml, /<a:t>Project<\/a:t>/);
    assert.match(erSlideXml, /<a:t>CUSTOMER<\/a:t>/);
    assert.match(ganttSlideXml, /<a:t>Launch Plan<\/a:t>/);
  });
});
