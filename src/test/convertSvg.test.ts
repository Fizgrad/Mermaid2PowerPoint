import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { convertSvgToPptx } from "../index.js";
import { getSampleSvg, readSlideXml, withTempDir } from "./helpers.js";

test("convertSvgToPptx outputs editable PowerPoint shapes instead of embedded pictures", async () => {
  const svg = await getSampleSvg();

  await withTempDir(async (dir) => {
    const outputPath = join(dir, "from-svg.pptx");
    await convertSvgToPptx(svg, outputPath);

    const slideXml = await readSlideXml(outputPath);
    assert.equal(slideXml.includes("<p:pic>"), false);
    assert.match(slideXml, /<a:prstGeom prst="rect"/);
    assert.match(slideXml, /<a:prstGeom prst="diamond"/);
    assert.match(slideXml, /<a:prstGeom prst="line/);
  });
});
