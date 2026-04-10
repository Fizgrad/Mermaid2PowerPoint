import test from "node:test";
import assert from "node:assert/strict";

import { createAppServer } from "../server.js";
import { readSlideXml } from "./helpers.js";

test("web export API returns a downloadable editable PPTX", async () => {
  const server = createAppServer();

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });

  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fileName: "web-export",
        mermaidCode: `flowchart TD
  A[Start] --> B{Check input}
  B --> C[Done]
`,
        theme: "default",
      }),
    });

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation/
    );

    const arrayBuffer = await response.arrayBuffer();
    const outputPath = `/tmp/server-api-export-${Date.now()}.pptx`;
    await import("node:fs/promises").then((fs) => fs.writeFile(outputPath, Buffer.from(arrayBuffer)));
    const slideXml = await readSlideXml(outputPath);
    assert.equal(slideXml.includes("<p:pic>"), false);
    assert.match(slideXml, /<a:t>Check input<\/a:t>/);
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
