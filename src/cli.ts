#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { convertMermaidFileToPptx, convertSvgToPptx } from "./index.js";
import type { ConvertSvgToPptxOptions, MermaidRenderOptions } from "./types.js";

interface CliOptions {
  background?: string;
  inputPath: string;
  inputType: "mermaid" | "svg";
  mmdcPath?: string;
  noSandbox?: boolean;
  outputPath: string;
  paddingPx?: number;
  puppeteerConfigFile?: string;
  scale?: number;
  theme?: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const convertOptions: ConvertSvgToPptxOptions = {
    slidePaddingPx: options.paddingPx,
  };

  if (options.inputType === "svg") {
    const svgString = await readFile(options.inputPath, "utf8");
    await convertSvgToPptx(svgString, options.outputPath, convertOptions);
    process.stdout.write(`Wrote ${options.outputPath}\n`);
    return;
  }

  const renderOptions: MermaidRenderOptions = {
    theme: options.theme,
    background: options.background,
    scale: options.scale,
    mmdcPath: options.mmdcPath,
    noSandbox: options.noSandbox,
    puppeteerConfigFile: options.puppeteerConfigFile,
  };

  await convertMermaidFileToPptx(options.inputPath, options.outputPath, renderOptions, convertOptions);
  process.stdout.write(`Wrote ${options.outputPath}\n`);
}

function parseArgs(argv: string[]): CliOptions {
  const positionals: string[] = [];
  const options: Partial<CliOptions> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "-o":
      case "--output":
        options.outputPath = requireValue(arg, argv[++index]);
        break;
      case "--input":
        options.inputType = parseInputType(requireValue(arg, argv[++index]));
        break;
      case "--theme":
        options.theme = requireValue(arg, argv[++index]);
        break;
      case "--background":
        options.background = requireValue(arg, argv[++index]);
        break;
      case "--scale":
        options.scale = Number.parseFloat(requireValue(arg, argv[++index]));
        break;
      case "--padding":
        options.paddingPx = Number.parseFloat(requireValue(arg, argv[++index]));
        break;
      case "--mmdc-path":
        options.mmdcPath = requireValue(arg, argv[++index]);
        break;
      case "--puppeteer-config":
        options.puppeteerConfigFile = requireValue(arg, argv[++index]);
        break;
      case "--no-sandbox":
        options.noSandbox = true;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        positionals.push(arg);
        break;
    }
  }

  if (positionals.length === 0) {
    printHelp();
    throw new Error("Missing input path.");
  }

  const inputPath = resolve(positionals[0]);
  const outputPath = resolve(options.outputPath ?? defaultOutputPath(inputPath));
  const inputType = options.inputType ?? inferInputType(inputPath);

  return {
    ...options,
    inputPath,
    inputType,
    outputPath,
  };
}

function parseInputType(value: string): "mermaid" | "svg" {
  if (value === "svg" || value === "mermaid") {
    return value;
  }

  throw new Error(`Unsupported input type: ${value}`);
}

function inferInputType(inputPath: string): "mermaid" | "svg" {
  return extname(inputPath).toLowerCase() === ".svg" ? "svg" : "mermaid";
}

function defaultOutputPath(inputPath: string): string {
  return inputPath.replace(/\.[^.]+$/, ".pptx");
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function printHelp(): void {
  process.stdout.write(`Mermaid2PowerPoint CLI

Usage:
  npm run cli -- <input.mmd> -o output.pptx
  npm run cli -- <input.svg> --input svg -o output.pptx

Options:
  -o, --output <path>      Output PPTX path
  --input <mermaid|svg>    Force input type; default infers from extension
  --theme <name>           Mermaid theme when input is .mmd
  --background <color>     Mermaid background when input is .mmd
  --scale <number>         Mermaid render scale when input is .mmd
  --padding <px>           Slide padding in SVG pixels (default: 24)
  --mmdc-path <path>       Explicit path to Mermaid CLI (mmdc)
  --puppeteer-config <p>   JSON config passed to mmdc --puppeteerConfigFile
  --no-sandbox             Add Chromium no-sandbox flags for containers/CI
  -h, --help               Show this help
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
