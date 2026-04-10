import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { convertSvgToPptx } from "../index.js";
import { getFixtureSvg, getSampleSvg, readSlideXml, withTempDir } from "./helpers.js";

test("convertSvgToPptx outputs editable PowerPoint shapes instead of embedded pictures", async () => {
  const svg = await getSampleSvg();

  await withTempDir(async (dir) => {
    const outputPath = join(dir, "from-svg.pptx");
    await convertSvgToPptx(svg, outputPath);

    const slideXml = await readSlideXml(outputPath);
    assert.equal(slideXml.includes("<p:pic>"), false);
    assert.match(slideXml, /<a:prstGeom prst="rect"/);
    assert.match(slideXml, /<a:prstGeom prst="diamond"/);
    assert.match(slideXml, /<a:custGeom>/);
  });
});

test("convertSvgToPptx maps extra Mermaid node shapes to native PowerPoint geometry", async () => {
  const svg = await getFixtureSvg("shape-regression");

  await withTempDir(async (dir) => {
    const outputPath = join(dir, "shape-regression.pptx");
    await convertSvgToPptx(svg, outputPath);

    const slideXml = await readSlideXml(outputPath);
    assert.match(slideXml, /<a:prstGeom prst="roundRect"/);
    assert.match(slideXml, /<a:prstGeom prst="ellipse"/);
    assert.match(slideXml, /<a:prstGeom prst="hexagon"/);
  });
});

test("convertSvgToPptx keeps curved edges as custom geometry and themed edge labels", async () => {
  const svg = await getFixtureSvg("styled-links");
  const curvedSvg = await getFixtureSvg("curved-basis");

  await withTempDir(async (dir) => {
    const styledOutput = join(dir, "styled-links.pptx");
    const curvedOutput = join(dir, "curved-basis.pptx");
    await convertSvgToPptx(svg, styledOutput);
    await convertSvgToPptx(curvedSvg, curvedOutput);

    const styledSlideXml = await readSlideXml(styledOutput);
    const curvedSlideXml = await readSlideXml(curvedOutput);

    assert.match(styledSlideXml, /<a:srgbClr val="C45C2C"/);
    assert.match(curvedSlideXml, /<a:custGeom>/);
  });
});

test("convertSvgToPptx exports subgraph clusters and image nodes", async () => {
  const clusterSvg = await getFixtureSvg("cluster-regression");
  const imageSvg = await getFixtureSvg("image-node");

  await withTempDir(async (dir) => {
    const clusterOutput = join(dir, "cluster-regression.pptx");
    const imageOutput = join(dir, "image-node.pptx");
    await convertSvgToPptx(clusterSvg, clusterOutput);
    await convertSvgToPptx(imageSvg, imageOutput);

    const clusterSlideXml = await readSlideXml(clusterOutput);
    const imageSlideXml = await readSlideXml(imageOutput);

    assert.match(clusterSlideXml, /<a:t>API Layer<\/a:t>/);
    assert.match(clusterSlideXml, /<a:srgbClr val="FFFFDE"/);
    assert.match(imageSlideXml, /<p:pic>/);
    assert.match(imageSlideXml, /<a:t>Brand<\/a:t>/);
  });
});

test("convertSvgToPptx exports sequence, mindmap, ER, and gantt diagrams as editable PPT content", async () => {
  const sequenceSvg = await getFixtureSvg("sequence-basic");
  const mindmapSvg = await getFixtureSvg("mindmap-basic");
  const erSvg = await getFixtureSvg("er-basic");
  const ganttSvg = await getFixtureSvg("gantt-basic");

  await withTempDir(async (dir) => {
    const sequenceOutput = join(dir, "sequence-basic.pptx");
    const mindmapOutput = join(dir, "mindmap-basic.pptx");
    const erOutput = join(dir, "er-basic.pptx");
    const ganttOutput = join(dir, "gantt-basic.pptx");

    await convertSvgToPptx(sequenceSvg, sequenceOutput);
    await convertSvgToPptx(mindmapSvg, mindmapOutput);
    await convertSvgToPptx(erSvg, erOutput);
    await convertSvgToPptx(ganttSvg, ganttOutput);

    const sequenceSlideXml = await readSlideXml(sequenceOutput);
    const mindmapSlideXml = await readSlideXml(mindmapOutput);
    const erSlideXml = await readSlideXml(erOutput);
    const ganttSlideXml = await readSlideXml(ganttOutput);

    assert.match(sequenceSlideXml, /<a:t>Hello Bob<\/a:t>/);
    assert.match(sequenceSlideXml, /<a:srgbClr val="333333"/);
    assert.match(mindmapSlideXml, /<a:t>Project<\/a:t>/);
    assert.match(mindmapSlideXml, /<a:prstGeom prst="roundRect"/);
    assert.match(erSlideXml, /<a:t>CUSTOMER<\/a:t>/);
    assert.match(erSlideXml, /<a:t>places<\/a:t>/);
    assert.match(ganttSlideXml, /<a:t>Launch Plan<\/a:t>/);
    assert.match(ganttSlideXml, /<a:prstGeom prst="roundRect"/);
  });
});
