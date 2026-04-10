import test from "node:test";
import assert from "node:assert/strict";

import { createAppServer } from "../server.js";
test("web server serves the browser export shell and pptx bundle", async () => {
  const server = createAppServer();

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const indexResponse = await fetch(`http://127.0.0.1:${address.port}/`);
    const indexHtml = await indexResponse.text();

    assert.equal(indexResponse.status, 200);
    assert.match(indexHtml, /Mermaid2PowerPoint/);
    assert.match(indexHtml, /vendor\/pptxgenjs\/pptxgen\.bundle\.js/);

    const bundleResponse = await fetch(`http://127.0.0.1:${address.port}/vendor/pptxgenjs/pptxgen.bundle.js`);
    const bundleBody = await bundleResponse.text();
    assert.equal(bundleResponse.status, 200);
    assert.match(bundleBody, /PptxGenJS/);
  } finally {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      server.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }
        resolvePromise();
      });
    });
  }
});
