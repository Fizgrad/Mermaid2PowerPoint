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

test("parseMermaidFlowchartSvg extracts subgraph clusters and their labels", async () => {
  const svg = await getFixtureSvg("cluster-regression");
  const diagram = parseMermaidFlowchartSvg(svg);

  assert.equal(diagram.clusters.length, 1);
  assert.equal(diagram.clusters[0].label?.text, "API Layer");
  assert.equal(diagram.clusters[0].style.fill?.hex, "FFFFDE");
  assert.equal(diagram.clusters[0].style.stroke?.hex, "AAAA33");
});

test("parseMermaidFlowchartSvg extracts image nodes with labels and image sources", async () => {
  const svg = await getFixtureSvg("image-node");
  const diagram = parseMermaidFlowchartSvg(svg);

  assert.equal(diagram.imageNodes.length, 1);
  assert.match(diagram.imageNodes[0].href, /^data:image\/png;base64,/);
  assert.equal(diagram.imageNodes[0].label?.text, "Brand");
  assert.equal(diagram.imageNodes[0].frameStyle?.fill?.hex, "ECECFF");
  assert.equal(diagram.imageNodes[0].frameStyle?.stroke?.hex, "9370DB");
});

test("parseMermaidFlowchartSvg preserves Mermaid sequence diagrams as editable shapes and labels", async () => {
  const svg = await getFixtureSvg("sequence-basic");
  const diagram = parseMermaidFlowchartSvg(svg);

  assert.equal(diagram.genericShapes.filter((shape) => shape.kind === "line").length >= 4, true);
  assert.equal(
    diagram.genericShapes.some((shape) => shape.kind === "line" && shape.style.stroke?.hex === "333333"),
    true
  );
  assert.equal(
    diagram.floatingTexts.some((text) => text.text === "Hello Bob"),
    true
  );
  assert.equal(
    diagram.floatingTexts.some((text) => text.text === "Sync complete"),
    true
  );
});

test("parseMermaidFlowchartSvg merges multi-line sequence notes into one floating text box", async () => {
  const svg = await getFixtureSvg("sequence-note-breaks");
  const diagram = parseMermaidFlowchartSvg(svg);

  const mergedNote = diagram.floatingTexts.find((text) => text.text.includes("如果有Profile"));
  assert.ok(mergedNote);
  assert.match(mergedNote.text, /加载镜像类描述\n如果有Profile\n则只加载DexFile和\nProfileCompilationInfo的交集/);
  assert.equal(diagram.floatingTexts.some((text) => text.text === "如果有Profile"), false);
});

test("parseMermaidFlowchartSvg keeps state diagrams editable with composite states, pseudo states, and note line breaks", async () => {
  const svg = await getFixtureSvg("state-basic");
  const diagram = parseMermaidFlowchartSvg(svg);

  assert.equal(diagram.clusters.some((cluster) => cluster.label?.text === "Running"), true);
  assert.equal(diagram.nodes.some((node) => node.kind === "roundRect" && node.text?.text === "Idle"), true);
  assert.equal(diagram.nodes.some((node) => node.kind === "ellipse"), true);
  assert.equal(diagram.markerDecorations.length > 0, false);
  assert.equal(
    diagram.nodes.some((node) => node.text?.text === "Worker\nloop"),
    true
  );
  assert.equal(diagram.edges.some((edge) => edge.label?.text === "finish"), true);
});

test("parseMermaidFlowchartSvg parses Mermaid mindmap nodes and themed branch colors", async () => {
  const svg = await getFixtureSvg("mindmap-basic");
  const diagram = parseMermaidFlowchartSvg(svg);

  assert.equal(diagram.nodes.length, 10);
  assert.equal(diagram.nodes[0].kind, "ellipse");
  assert.equal(
    diagram.nodes.some((node) => node.kind === "roundRect" && node.text?.text === "Engineering"),
    true
  );
  assert.equal(diagram.nodes.some((node) => node.style.fill?.hex === "FFFF78"), true);
  assert.equal(diagram.edges.some((edge) => edge.style.stroke?.hex === "FFFF78"), true);
  assert.equal(diagram.edges.some((edge) => edge.geometry?.hasCurves), true);
});

test("parseMermaidFlowchartSvg parses Mermaid ER diagrams into entity nodes, labels, and relationships", async () => {
  const svg = await getFixtureSvg("er-basic");
  const diagram = parseMermaidFlowchartSvg(svg);

  assert.deepEqual(
    diagram.nodes.map((node) => node.text?.text),
    ["CUSTOMER", "ORDER"]
  );
  assert.equal(diagram.edges.length, 1);
  assert.equal(diagram.edges[0].label?.text, "places");
  assert.equal(diagram.edges[0].style.stroke?.hex, "333333");
  assert.equal(
    diagram.floatingTexts.some((text) => text.text === "created_at"),
    true
  );
});

test("parseMermaidFlowchartSvg expands ER cardinality markers into editable decorations", async () => {
  const svg = await getFixtureSvg("er-cardinality");
  const diagram = parseMermaidFlowchartSvg(svg);

  assert.equal(diagram.edges.length, 4);
  assert.equal(diagram.markerDecorations.length >= 8, true);
  assert.equal(diagram.markerDecorations.some((shape) => shape.kind === "ellipse"), true);
  assert.equal(diagram.markerDecorations.some((shape) => shape.kind === "customGeometry"), true);
  assert.equal(
    diagram.edges.every((edge) => edge.startArrow === undefined && edge.endArrow === undefined),
    true
  );
});

test("parseMermaidFlowchartSvg maps class/object-style relationship markers to editable arrow types", async () => {
  const svg = await getFixtureSvg("class-relations");
  const diagram = parseMermaidFlowchartSvg(svg);
  const byLabel = new Map(diagram.edges.map((edge) => [edge.label?.text, edge]));

  assert.equal(byLabel.get("extends")?.startArrow, "triangle");
  assert.equal(byLabel.get("composition")?.startArrow, "diamond");
  assert.equal(byLabel.get("aggregation")?.startArrow, "diamond");
  assert.equal(byLabel.get("association")?.endArrow, "stealth");
  assert.equal(byLabel.get("dependency")?.endArrow, "stealth");
  assert.equal(byLabel.get("lollipop")?.endArrow, "oval");
});

test("parseMermaidFlowchartSvg parses Mermaid gantt charts into timeline bars and labels", async () => {
  const svg = await getFixtureSvg("gantt-basic");
  const diagram = parseMermaidFlowchartSvg(svg);

  assert.equal(diagram.genericShapes.some((shape) => shape.kind === "roundRect"), true);
  assert.equal(diagram.genericShapes.some((shape) => shape.style.fill?.hex === "8A90DD"), true);
  assert.equal(diagram.genericShapes.some((shape) => shape.style.fill?.hex === "BFC7FF"), true);
  assert.equal(diagram.floatingTexts.some((text) => text.text === "Launch Plan"), true);
  assert.equal(diagram.floatingTexts.some((text) => text.text === "Release"), true);
});
