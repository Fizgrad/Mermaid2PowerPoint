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
  const specialSvg = await getFixtureSvg("flowchart-special-shapes");
  const presetSvg = await getFixtureSvg("flowchart-preset-nodes");

  await withTempDir(async (dir) => {
    const outputPath = join(dir, "shape-regression.pptx");
    const specialOutputPath = join(dir, "flowchart-special-shapes.pptx");
    const presetOutputPath = join(dir, "flowchart-preset-nodes.pptx");
    await convertSvgToPptx(svg, outputPath);
    await convertSvgToPptx(specialSvg, specialOutputPath);
    await convertSvgToPptx(presetSvg, presetOutputPath);

    const slideXml = await readSlideXml(outputPath);
    const specialSlideXml = await readSlideXml(specialOutputPath);
    const presetSlideXml = await readSlideXml(presetOutputPath);
    assert.match(slideXml, /<a:prstGeom prst="roundRect"/);
    assert.match(slideXml, /<a:prstGeom prst="ellipse"/);
    assert.match(slideXml, /<a:prstGeom prst="hexagon"/);
    assert.match(specialSlideXml, /<a:prstGeom prst="flowChartInputOutput"/);
    assert.match(specialSlideXml, /<a:prstGeom prst="flowChartPredefinedProcess"/);
    assert.match(specialSlideXml, /<a:prstGeom prst="flowChartMagneticDisk"/);
    assert.match(specialSlideXml, /<a:t>Database<\/a:t>/);
    assert.match(specialSlideXml, /<a:t>Asymmetric<\/a:t>/);
    assert.match(presetSlideXml, /<a:prstGeom prst="flowChartManualInput"/);
    assert.match(presetSlideXml, /<a:prstGeom prst="flowChartDocument"/);
    assert.match(presetSlideXml, /<a:prstGeom prst="flowChartDisplay"/);
    assert.match(presetSlideXml, /<a:prstGeom prst="flowChartInternalStorage"/);
    assert.match(presetSlideXml, /<a:prstGeom prst="flowChartManualOperation"/);
    assert.match(specialSlideXml, /<a:custGeom>/);
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
  const stateSvg = await getFixtureSvg("state-basic");
  const mindmapSvg = await getFixtureSvg("mindmap-basic");
  const erSvg = await getFixtureSvg("er-basic");
  const erCardinalitySvg = await getFixtureSvg("er-cardinality");
  const ganttSvg = await getFixtureSvg("gantt-basic");

  await withTempDir(async (dir) => {
    const sequenceOutput = join(dir, "sequence-basic.pptx");
    const stateOutput = join(dir, "state-basic.pptx");
    const mindmapOutput = join(dir, "mindmap-basic.pptx");
    const erOutput = join(dir, "er-basic.pptx");
    const erCardinalityOutput = join(dir, "er-cardinality.pptx");
    const ganttOutput = join(dir, "gantt-basic.pptx");

    await convertSvgToPptx(sequenceSvg, sequenceOutput);
    await convertSvgToPptx(stateSvg, stateOutput);
    await convertSvgToPptx(mindmapSvg, mindmapOutput);
    await convertSvgToPptx(erSvg, erOutput);
    await convertSvgToPptx(erCardinalitySvg, erCardinalityOutput);
    await convertSvgToPptx(ganttSvg, ganttOutput);

    const sequenceSlideXml = await readSlideXml(sequenceOutput);
    const stateSlideXml = await readSlideXml(stateOutput);
    const mindmapSlideXml = await readSlideXml(mindmapOutput);
    const erSlideXml = await readSlideXml(erOutput);
    const erCardinalitySlideXml = await readSlideXml(erCardinalityOutput);
    const ganttSlideXml = await readSlideXml(ganttOutput);

    assert.match(sequenceSlideXml, /<a:t>Hello Bob<\/a:t>/);
    assert.match(sequenceSlideXml, /<a:t>Alice<\/a:t>/);
    assert.match(sequenceSlideXml, /<a:custGeom>/);
    assert.match(sequenceSlideXml, /<a:srgbClr val="333333"/);
    assert.match(stateSlideXml, /<a:t>Running<\/a:t>/);
    assert.match(stateSlideXml, /<a:t>Worker<\/a:t>/);
    assert.match(stateSlideXml, /<a:prstGeom prst="roundRect"/);
    assert.match(mindmapSlideXml, /<a:t>Project<\/a:t>/);
    assert.match(mindmapSlideXml, /<a:prstGeom prst="roundRect"/);
    assert.match(erSlideXml, /<a:t>CUSTOMER<\/a:t>/);
    assert.match(erSlideXml, /<a:t>places<\/a:t>/);
    assert.match(erCardinalitySlideXml, /<a:t>PROFILE<\/a:t>/);
    assert.match(erCardinalitySlideXml, /<a:prstGeom prst="ellipse"/);
    assert.match(erCardinalitySlideXml, /<a:custGeom>/);
    assert.match(ganttSlideXml, /<a:t>Launch Plan<\/a:t>/);
    assert.match(ganttSlideXml, /<a:prstGeom prst="roundRect"/);
  });
});

test("convertSvgToPptx keeps merged sequence notes and class relation marker types", async () => {
  const sequenceNoteSvg = await getFixtureSvg("sequence-note-breaks");
  const classRelationsSvg = await getFixtureSvg("class-relations");

  await withTempDir(async (dir) => {
    const sequenceOutput = join(dir, "sequence-note-breaks.pptx");
    const classOutput = join(dir, "class-relations.pptx");

    await convertSvgToPptx(sequenceNoteSvg, sequenceOutput);
    await convertSvgToPptx(classRelationsSvg, classOutput);

    const sequenceSlideXml = await readSlideXml(sequenceOutput);
    const classSlideXml = await readSlideXml(classOutput);

    assert.match(sequenceSlideXml, /<a:t>加载镜像类描述<\/a:t>/);
    assert.match(sequenceSlideXml, /<a:t>如果有Profile<\/a:t>/);
    assert.match(sequenceSlideXml, /<a:t>ProfileCompilationInfo的交集<\/a:t>/);
    assert.match(classSlideXml, /<a:custGeom>/);
    assert.match(classSlideXml, /<a:prstGeom prst="ellipse"/);
    assert.match(classSlideXml, /type="stealth"/);
  });
});
