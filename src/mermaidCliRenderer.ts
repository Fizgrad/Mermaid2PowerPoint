import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

import type { MermaidRenderOptions } from "./types.js";

export async function renderMermaidFileToSvg(
  inputPath: string,
  options: MermaidRenderOptions = {}
): Promise<string> {
  const mmdcPath = await findMermaidCli(options.mmdcPath);
  const tempDir = await mkdtemp(join(tmpdir(), "mermaid2pptx-"));
  const outputPath = join(tempDir, "diagram.svg");

  try {
    await renderWithMermaidCli(mmdcPath, resolve(inputPath), outputPath, tempDir, options);
    return await readFile(outputPath, "utf8");
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

export async function renderMermaidCodeToSvg(
  mermaidCode: string,
  options: MermaidRenderOptions = {}
): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "mermaid2pptx-src-"));
  const inputPath = join(tempDir, "diagram.mmd");

  try {
    await writeFile(inputPath, mermaidCode, "utf8");
    return await renderMermaidFileToSvg(inputPath, options);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
}

export async function findMermaidCli(explicitPath?: string): Promise<string> {
  const candidates = [
    explicitPath,
    process.env.MERMAID_CLI_PATH,
    join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "mmdc.cmd" : "mmdc"),
    "mmdc",
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (candidate === "mmdc") {
      return candidate;
    }

    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    "Unable to find Mermaid CLI (`mmdc`). Install @mermaid-js/mermaid-cli or set MERMAID_CLI_PATH."
  );
}

async function renderWithMermaidCli(
  mmdcPath: string,
  inputPath: string,
  outputPath: string,
  tempDir: string,
  options: MermaidRenderOptions
): Promise<void> {
  const runAttempt = async (noSandbox: boolean): Promise<void> => {
    const puppeteerConfigPath = await createPuppeteerConfig(tempDir, options, noSandbox);
    const args = [
      "-i",
      inputPath,
      "-o",
      outputPath,
      "-e",
      "svg",
      "-t",
      options.theme ?? "default",
      "-b",
      options.background ?? "white",
    ];

    if (options.scale && options.scale !== 1) {
      args.push("-s", String(options.scale));
    }

    if (puppeteerConfigPath) {
      args.push("-p", puppeteerConfigPath);
    }

    await execFile(mmdcPath, args);
  };

  try {
    await runAttempt(Boolean(options.noSandbox));
  } catch (error) {
    if (!options.noSandbox && shouldRetryWithoutSandbox(error)) {
      await runAttempt(true);
      return;
    }

    throw error;
  }
}

async function createPuppeteerConfig(
  tempDir: string,
  options: MermaidRenderOptions,
  noSandbox: boolean
): Promise<string | undefined> {
  if (!options.puppeteerConfigFile && !noSandbox) {
    return undefined;
  }

  const baseConfig = options.puppeteerConfigFile
    ? JSON.parse(await readFile(resolve(options.puppeteerConfigFile), "utf8")) as Record<string, unknown>
    : {};
  const baseArgs = Array.isArray(baseConfig.args) ? baseConfig.args.filter(isString) : [];
  const mergedArgs = noSandbox
    ? Array.from(new Set([...baseArgs, "--no-sandbox", "--disable-setuid-sandbox"]))
    : baseArgs;
  const mergedConfig: Record<string, unknown> = {
    ...baseConfig,
    args: mergedArgs,
  };
  const configPath = join(tempDir, "puppeteer.config.json");
  await writeFile(configPath, JSON.stringify(mergedConfig), "utf8");
  return configPath;
}

function shouldRetryWithoutSandbox(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Failed to launch the browser process|sandbox_host_linux|No usable sandbox/i.test(message);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function execFile(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        rejectPromise(
          new Error(
            `Unable to execute Mermaid CLI (${command}). Install @mermaid-js/mermaid-cli or set MERMAID_CLI_PATH.`
          )
        );
        return;
      }

      rejectPromise(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      const details = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
      rejectPromise(new Error(details || `Command failed: ${command} ${args.join(" ")}`));
    });
  });
}
