import { resolve } from "node:path";

import { convertSvgToPptx } from "../index.js";

const mockSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 140" style="background-color: white;">
  <style>
    .node rect { fill: #ECECFF; stroke: #9370DB; stroke-width: 1px; }
    .flowchart-link { fill: none; stroke: #333333; stroke-width: 2px; }
    .label { color: #333333; font-size: 16px; text-align: center; }
  </style>
  <g class="edgePaths">
    <path class="flowchart-link" data-id="edge-1" d="M100 70 L160 70 L220 70" marker-end="url(#arrow)"/>
  </g>
  <g class="nodes">
    <g class="node default" id="node-a" transform="translate(60, 70)">
      <rect class="label-container" x="-40" y="-20" width="80" height="40"></rect>
      <g class="label" transform="translate(-24, -11)">
        <foreignObject width="48" height="22">
          <div xmlns="http://www.w3.org/1999/xhtml"><span>Start</span></div>
        </foreignObject>
      </g>
    </g>
    <g class="node default" id="node-b" transform="translate(260, 70)">
      <rect class="label-container" x="-40" y="-20" width="80" height="40"></rect>
      <g class="label" transform="translate(-21, -11)">
        <foreignObject width="42" height="22">
          <div xmlns="http://www.w3.org/1999/xhtml"><span>End</span></div>
        </foreignObject>
      </g>
    </g>
  </g>
</svg>
`;

const outputPath = resolve(process.cwd(), "mock-flowchart.pptx");

await convertSvgToPptx(mockSvg, outputPath, {
  title: "Mock flowchart",
});

process.stdout.write(`Wrote ${outputPath}\n`);
