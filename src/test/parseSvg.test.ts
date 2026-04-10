import test from "node:test";
import assert from "node:assert/strict";

import { parseMermaidFlowchartSvg } from "../parseSvg.js";
import { getFixtureSvg, getSampleSvg } from "./helpers.js";

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

test("parseMermaidFlowchartSvg detects rounded, circular, and hexagonal Mermaid nodes", async () => {
  const svg = await getFixtureSvg("shape-regression");
  const diagram = parseMermaidFlowchartSvg(svg);

  assert.deepEqual(
    diagram.nodes.map((node) => node.kind),
    ["roundRect", "ellipse", "hexagon", "rect"]
  );
});

test("parseMermaidFlowchartSvg preserves styled edge labels and classDef colors", async () => {
  const svg = await getFixtureSvg("styled-links");
  const diagram = parseMermaidFlowchartSvg(svg);

  assert.equal(diagram.nodes[0].style.fill?.hex, "FFD7BA");
  assert.equal(diagram.nodes[0].style.stroke?.hex, "C45C2C");
  assert.equal(diagram.nodes[1].style.fill?.hex, "D9F4FF");
  assert.equal(diagram.nodes[1].style.stroke?.hex, "12738B");
  assert.equal(diagram.edges[0].style.stroke?.hex, "C45C2C");
  assert.equal(diagram.edges[1].style.stroke?.hex, "12738B");
  assert.equal(diagram.edges[0].label?.boxStyle?.fill?.hex, "E8E8E8");
  assert.equal(diagram.edges[0].label?.text, "yes");
});

test("parseMermaidFlowchartSvg preserves bezier edge geometry for curved Mermaid output", async () => {
  const svg = await getFixtureSvg("curved-basis");
  const diagram = parseMermaidFlowchartSvg(svg);

  assert.equal(
    diagram.edges.some((edge) => edge.geometry?.hasCurves),
    true
  );
  assert.equal(
    diagram.edges.some((edge) => edge.geometry?.commands.some((command) => command.type === "cubicTo")),
    true
  );
});
