import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { convertMermaidCodeToPptxBuffer } from "./index.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(currentDir, "..");
const webRoot = resolve(repoRoot, "web");
const mermaidVendorRoot = resolve(repoRoot, "node_modules", "mermaid", "dist");
const defaultPort = Number.parseInt(process.env.PORT ?? "3000", 10);

interface ExportRequestBody {
  background?: string;
  fileName?: string;
  mermaidCode?: string;
  scale?: number;
  slidePaddingPx?: number;
  theme?: string;
}

export function createAppServer() {
  return createServer(async (request, response) => {
    try {
      await routeRequest(request, response);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : "Unexpected server error.",
      });
    }
  });
}

async function routeRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const method = request.method ?? "GET";
  const isReadMethod = method === "GET" || method === "HEAD";
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);

  if (method === "GET" && pathname === "/api/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && pathname === "/api/export") {
    await handleExport(request, response);
    return;
  }

  if (isReadMethod && pathname.startsWith("/vendor/mermaid/")) {
    const relativePath = pathname.slice("/vendor/mermaid/".length);
    await serveStaticFile(response, mermaidVendorRoot, relativePath, method);
    return;
  }

  if (isReadMethod) {
    const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
    await serveStaticFile(response, webRoot, relativePath, method);
    return;
  }

  sendJson(response, 405, { error: "Method not allowed." });
}

async function handleExport(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<ExportRequestBody>(request);
  const mermaidCode = body.mermaidCode?.trim();

  if (!mermaidCode) {
    sendJson(response, 400, { error: "mermaidCode is required." });
    return;
  }

  const safeFileName = normalizePptxFileName(body.fileName);
  const noSandbox = isTruthy(process.env.MERMAID_NO_SANDBOX);
  const pptxBuffer = await convertMermaidCodeToPptxBuffer(mermaidCode, {
    render: {
      background: body.background,
      noSandbox,
      scale: body.scale,
      theme: body.theme,
    },
    convert: {
      author: "Mermaid2PowerPoint Web",
      company: "Mermaid2PowerPoint",
      slidePaddingPx: body.slidePaddingPx,
      title: safeFileName.replace(/\.pptx$/i, ""),
    },
  });

  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Disposition": `attachment; filename="${safeFileName}"`,
    "Content-Length": String(pptxBuffer.length),
    "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
  response.end(pptxBuffer);
}

async function serveStaticFile(
  response: ServerResponse,
  rootDir: string,
  relativePath: string,
  method: "GET" | "HEAD"
): Promise<void> {
  const safePath = normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = resolve(rootDir, safePath);
  if (!filePath.startsWith(rootDir)) {
    sendJson(response, 403, { error: "Forbidden." });
    return;
  }

  try {
    await access(filePath);
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": getContentType(filePath),
      "Content-Length": String(fileStats.size),
    });
    if (method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, { error: "Not found." });
  }
}

function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  return new Promise((resolvePromise, rejectPromise) => {
    let body = "";

    request.on("data", (chunk: Buffer | string) => {
      body += chunk.toString();
      if (body.length > 1024 * 1024) {
        rejectPromise(new Error("Request body too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolvePromise((body ? JSON.parse(body) : {}) as T);
      } catch {
        rejectPromise(new Error("Invalid JSON request body."));
      }
    });

    request.on("error", rejectPromise);
  });
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Length": String(Buffer.byteLength(body)),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(body);
}

function normalizePptxFileName(fileName: string | undefined): string {
  const base = (fileName ?? "mermaid-diagram")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const normalized = base || "mermaid-diagram";
  return normalized.toLowerCase().endsWith(".pptx") ? normalized : `${normalized}.pptx`;
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function getContentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".map":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

async function start(): Promise<void> {
  const server = createAppServer();
  await new Promise<void>((resolvePromise) => {
    server.listen(defaultPort, "127.0.0.1", () => resolvePromise());
  });
  process.stdout.write(`Mermaid2PowerPoint web app running at http://127.0.0.1:${defaultPort}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  start().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
