import mermaid from "./vendor/mermaid/mermaid.esm.min.mjs";
import { exportSvgElementToPptx } from "./pptx-export.js";

const DOWNLOAD_BUTTON_LABEL = "生成可编辑 PPT";
const READY_TO_EXPORT_MESSAGE = "语法已通过；可以直接在当前页面导出可编辑的 PPT。";
const WAIT_FOR_VALIDATION_MESSAGE = "先通过语法检查后才允许导出。";
const EXPORT_IN_PROGRESS_MESSAGE = "浏览器正在把当前 SVG 转成可编辑的 PPT。";
const EXPORT_MODE_MESSAGE = "浏览器导出模式";
const EXPORT_LIBRARY_MISSING_MESSAGE = "浏览器导出库没有加载成功，当前页面无法生成 PPT。";

const sampleDiagram = `flowchart TD
    A[Start] --> B{Check input}
    B -->|valid| C[Render Mermaid]
    B -->|invalid| D[Show error]
    C --> E[Create PPT slide]
    D --> E
    E --> F[Done]
`;

const editor = document.querySelector("#editor");
const previewFrame = document.querySelector("#preview-frame");
const errorBox = document.querySelector("#error-box");
const syntaxStatus = document.querySelector("#syntax-status");
const exportStatus = document.querySelector("#export-status");
const themeSelect = document.querySelector("#theme-select");
const backgroundInput = document.querySelector("#background-input");
const fileNameInput = document.querySelector("#filename-input");
const downloadButton = document.querySelector("#download-button");
const sampleButton = document.querySelector("#sample-button");
const helperText = document.querySelector("#helper-text");

let latestRenderToken = 0;
let currentIsValid = false;
let exportAvailable = typeof window.PptxGenJS === "function";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "loose",
  theme: themeSelect.value,
});

editor.value = sampleDiagram;

const debouncedRender = debounce(validateAndRender, 260);

editor.addEventListener("input", () => {
  setIdleState("检查语法中…");
  debouncedRender();
});

themeSelect.addEventListener("change", () => {
  setIdleState("重新渲染中…");
  debouncedRender();
});

backgroundInput.addEventListener("input", updatePreviewBackground);

sampleButton.addEventListener("click", () => {
  editor.value = sampleDiagram;
  setIdleState("载入示例后重新渲染中…");
  validateAndRender();
});

downloadButton.addEventListener("click", async () => {
  if (!currentIsValid || !exportAvailable) {
    return;
  }

  downloadButton.disabled = true;
  downloadButton.textContent = "正在生成…";
  helperText.textContent = EXPORT_IN_PROGRESS_MESSAGE;

  try {
    const svgElement = previewFrame.querySelector("svg");
    if (!svgElement) {
      throw new Error("当前没有可导出的 SVG 预览。请先通过 Mermaid 语法检查。");
    }

    await exportSvgElementToPptx(svgElement, {
      backgroundColor: backgroundInput.value,
      fileName: normalizeFileName(fileNameInput.value),
      title: normalizePresentationTitle(fileNameInput.value),
    });

    helperText.textContent = "PPT 已生成。下载文件里是可编辑的原生 shape/text。";
  } catch (error) {
    helperText.textContent = error instanceof Error ? error.message : "导出失败。";
  } finally {
    syncDownloadState();
  }
});

setExportModeState();
updatePreviewBackground();
validateAndRender();

async function validateAndRender() {
  const code = editor.value.trim();
  const token = ++latestRenderToken;

  if (!code) {
    currentIsValid = false;
    syncDownloadState();
    syntaxStatus.textContent = "等待输入";
    syntaxStatus.className = "status-pill status-idle";
    previewFrame.innerHTML = `<div class="empty-state"><p>请输入 Mermaid 代码。</p></div>`;
    errorBox.hidden = true;
    helperText.textContent = WAIT_FOR_VALIDATION_MESSAGE;
    return;
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: themeSelect.value,
  });

  try {
    await mermaid.parse(code, { suppressErrors: false });
    const renderId = `preview-${token}`;
    const { svg, bindFunctions } = await mermaid.render(renderId, code);
    if (token !== latestRenderToken) {
      return;
    }

    previewFrame.innerHTML = svg;
    bindFunctions?.(previewFrame);
    errorBox.hidden = true;
    currentIsValid = true;
    syncDownloadState();
    syntaxStatus.textContent = "语法通过";
    syntaxStatus.className = "status-pill status-ok";
    helperText.textContent = exportAvailable ? READY_TO_EXPORT_MESSAGE : EXPORT_LIBRARY_MISSING_MESSAGE;
  } catch (error) {
    if (token !== latestRenderToken) {
      return;
    }

    currentIsValid = false;
    syncDownloadState();
    syntaxStatus.textContent = "语法错误";
    syntaxStatus.className = "status-pill status-error";
    previewFrame.innerHTML = `<div class="empty-state"><p>当前 Mermaid 无法通过语法检查，预览已暂停。</p></div>`;
    errorBox.hidden = false;
    errorBox.textContent = formatError(error);
    helperText.textContent = "修复语法错误后才能导出。";
  }
}

function setIdleState(message) {
  syntaxStatus.textContent = message;
  syntaxStatus.className = "status-pill status-idle";
}

function setExportModeState() {
  exportAvailable = typeof window.PptxGenJS === "function";
  exportStatus.textContent = exportAvailable ? EXPORT_MODE_MESSAGE : "导出库未加载";
  exportStatus.className = exportAvailable
    ? "status-pill status-ok"
    : "status-pill status-error";
  syncDownloadState();
}

function syncDownloadState() {
  downloadButton.disabled = !(currentIsValid && exportAvailable);
  downloadButton.textContent = DOWNLOAD_BUTTON_LABEL;
  downloadButton.title = exportAvailable
    ? "在当前浏览器里直接生成并下载可编辑的 PowerPoint 文件。"
    : EXPORT_LIBRARY_MISSING_MESSAGE;
}

function formatError(error) {
  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object") {
    if ("str" in error && typeof error.str === "string") {
      return error.str;
    }
    if ("message" in error && typeof error.message === "string") {
      return error.message;
    }
  }

  return "Mermaid 语法检查失败。";
}

function normalizeFileName(input) {
  const trimmed = (input || "mermaid-diagram").trim();
  return trimmed.toLowerCase().endsWith(".pptx") ? trimmed : `${trimmed}.pptx`;
}

function normalizePresentationTitle(input) {
  return normalizeFileName(input).replace(/\.pptx$/i, "");
}

function updatePreviewBackground() {
  previewFrame.style.setProperty("--preview-paper", backgroundInput.value);
}

function debounce(fn, waitMs) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      fn(...args);
    }, waitMs);
  };
}
