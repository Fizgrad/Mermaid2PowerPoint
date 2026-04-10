import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { convertMermaidFileToPptx } from "../index.js";
import { getSampleMermaidPath, readSlideXml, withTempDir } from "./helpers.js";

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
