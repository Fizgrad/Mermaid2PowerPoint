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
