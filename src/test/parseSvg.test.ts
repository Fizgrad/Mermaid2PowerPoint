import test from "node:test";
import assert from "node:assert/strict";

import { parseMermaidFlowchartSvg } from "../parseSvg.js";
import { getSampleSvg } from "./helpers.js";

test("parseMermaidFlowchartSvg extracts nodes, edges, and labels from Mermaid SVG", async () => {
  const svg = await getSampleSvg();
  const diagram = parseMermaidFlowchartSvg(svg);

  assert.equal(diagram.nodes.length, 6);
  assert.equal(diagram.edges.length, 6);
  assert.equal(
    diagram.nodes.filter((node) => node.kind === "diamond").length,
    1
  );

  const nodeLabels = diagram.nodes.map((node) => node.text?.text).filter(Boolean);
  assert.deepEqual(nodeLabels, [
    "Start",
    "Check input",
    "Render Mermaid",
    "Show error",
    "Create PPT slide",
    "Done",
  ]);

  const edgeLabels = diagram.edges
    .map((edge) => edge.label?.text)
    .filter((label): label is string => Boolean(label));
  assert.deepEqual(edgeLabels, ["valid", "invalid"]);
});
