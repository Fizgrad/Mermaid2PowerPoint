import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceWebDir = join(rootDir, "web");
const mermaidDistDir = join(rootDir, "node_modules", "mermaid", "dist");
const outDir = join(rootDir, "pages-dist");
const vendorOutDir = join(outDir, "vendor", "mermaid");

await rm(outDir, { force: true, recursive: true });
await mkdir(vendorOutDir, { recursive: true });

await cp(sourceWebDir, outDir, { recursive: true });
await cp(mermaidDistDir, vendorOutDir, { recursive: true });
await writeFile(join(outDir, ".nojekyll"), "", "utf8");

process.stdout.write(`Built GitHub Pages site into ${outDir}\n`);
