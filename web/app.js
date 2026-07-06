import mermaid from "./vendor/mermaid/mermaid.esm.min.mjs";
import { exportSvgElementToPptx } from "./pptx-export.js";

const I18N = {
  zh: {
    lede: `在网页里输入 Mermaid，实时做语法检查和预览，然后在浏览器里直接下载真正可编辑的 <code>.pptx</code> 文件。`,
    editorTitle: "Mermaid 输入",
    previewTitle: "渲染预览",
    themeLabel: "主题",
    bgLabel: "背景",
    filenameLabel: "文件名",
    sampleButton: "载入示例",
    codeLabel: "Mermaid 代码",
    downloadButton: "导出 PPT",
    emptyPreview: "在左侧输入 Mermaid，预览会显示在这里。",
    statusWaiting: "等待输入",
    statusExportReady: "准备浏览器导出",
    statusChecking: "检查语法中…",
    statusRerendering: "重新渲染中…",
    statusSampleLoading: "载入示例后重新渲染中…",
    statusSyntaxOk: "语法通过",
    statusSyntaxError: "语法错误",
    statusExportMode: "浏览器导出模式",
    statusExportLibMissing: "导出库未加载",
    helperDone: "PPT 已生成。下载文件里是可编辑的原生 shape/text。",
    helperFailed: "导出失败。",
    helperExportLibMissing: "浏览器导出库没有加载成功，当前页面无法生成 PPT。",
    generating: "正在生成…",
    emptyStateNoCode: "请输入 Mermaid 代码。",
    emptyStateSyntaxError: "当前 Mermaid 无法通过语法检查，预览已暂停。",
    noSvgError: "当前没有可导出的 SVG 预览。请先通过 Mermaid 语法检查。",
    parseFailed: "Mermaid 语法检查失败。",
    downloadTooltip: "在当前浏览器里直接生成并下载可编辑的 PowerPoint 文件。",
    toggleTheme: "切换深浅主题",
    toggleLang: "切换语言",
  },
  en: {
    lede: `Type Mermaid in the browser with real-time syntax checking and preview, then download a truly editable <code>.pptx</code> file directly from your browser.`,
    editorTitle: "Mermaid Input",
    previewTitle: "Render Preview",
    themeLabel: "Theme",
    bgLabel: "Background",
    filenameLabel: "File name",
    sampleButton: "Load sample",
    codeLabel: "Mermaid code",
    downloadButton: "Export PPT",
    emptyPreview: "Enter Mermaid on the left; the preview appears here.",
    statusWaiting: "Waiting for input",
    statusExportReady: "Ready to export",
    statusChecking: "Checking syntax…",
    statusRerendering: "Re-rendering…",
    statusSampleLoading: "Reloading sample…",
    statusSyntaxOk: "Syntax OK",
    statusSyntaxError: "Syntax error",
    statusExportMode: "Browser export mode",
    statusExportLibMissing: "Export lib not loaded",
    helperDone: "PPT generated. The download contains native editable shapes/text.",
    helperFailed: "Export failed.",
    helperExportLibMissing: "The browser export library failed to load; this page cannot generate a PPT.",
    generating: "Generating…",
    emptyStateNoCode: "Please enter Mermaid code.",
    emptyStateSyntaxError: "Mermaid failed syntax check; preview is paused.",
    noSvgError: "No exportable SVG preview. Please pass the Mermaid syntax check first.",
    parseFailed: "Mermaid syntax check failed.",
    downloadTooltip: "Generate and download an editable PowerPoint file directly in this browser.",
    toggleTheme: "Toggle light/dark theme",
    toggleLang: "Switch language",
  },
};

let currentLang = document.documentElement.getAttribute("data-lang") || "zh";
function t(key) {
  return (I18N[currentLang] ?? I18N.zh)[key] ?? key;
}

function applyLang(lang) {
  currentLang = lang;
  document.documentElement.setAttribute("data-lang", lang);
  document.documentElement.setAttribute("lang", lang === "zh" ? "zh-CN" : "en");
  try {
    localStorage.setItem("m2p-lang", lang);
  } catch (e) {}

  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll("[data-i18n-html]")) {
    el.innerHTML = t(el.dataset.i18nHtml);
  }
  for (const el of document.querySelectorAll("[data-i18n-title]")) {
    el.title = t(el.dataset.i18nTitle);
  }

  // 刷新动态文案
  refreshDynamicText();
}

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

let latestRenderToken = 0;
let currentIsValid = false;
let currentSyntaxState = "idle";
let currentExportState = "ready";
let exportAvailable = typeof window.PptxGenJS === "function";
let isExporting = false;
let feedbackTimer = 0;

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "loose",
  theme: themeSelect.value,
});

editor.value = sampleDiagram;

const debouncedRender = debounce(validateAndRender, 260);

editor.addEventListener("input", () => {
  currentSyntaxState = "checking";
  refreshDynamicText();
  debouncedRender();
});

themeSelect.addEventListener("change", () => {
  currentSyntaxState = "rerendering";
  refreshDynamicText();
  debouncedRender();
});

backgroundInput.addEventListener("input", updatePreviewBackground);

const themeToggle = document.querySelector("#theme-toggle");
themeToggle?.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("m2p-theme", next);
  } catch (e) {}
});

const langToggle = document.querySelector("#lang-toggle");
langToggle?.addEventListener("click", () => {
  applyLang(currentLang === "zh" ? "en" : "zh");
});

sampleButton.addEventListener("click", () => {
  editor.value = sampleDiagram;
  currentSyntaxState = "sampleLoading";
  refreshDynamicText();
  validateAndRender();
});

downloadButton.addEventListener("click", async () => {
  if (!currentIsValid || !exportAvailable) {
    return;
  }

  isExporting = true;
  downloadButton.disabled = true;
  downloadButton.textContent = t("generating");

  try {
    const svgElement = previewFrame.querySelector("svg");
    if (!svgElement) {
      throw new Error(t("noSvgError"));
    }

    await exportSvgElementToPptx(svgElement, {
      backgroundColor: backgroundInput.value,
      fileName: normalizeFileName(fileNameInput.value),
      title: normalizePresentationTitle(fileNameInput.value),
    });

    showButtonFeedback(t("helperDone"));
  } catch (error) {
    const message = error instanceof Error ? error.message : t("helperFailed");
    errorBox.hidden = false;
    errorBox.textContent = message;
    showButtonFeedback(t("helperFailed"));
  } finally {
    isExporting = false;
    // 只更新禁用状态，文字留给 showButtonFeedback 的定时器恢复
    downloadButton.disabled = !(currentIsValid && exportAvailable);
  }
});

function showButtonFeedback(message) {
  downloadButton.textContent = message;
  window.clearTimeout(feedbackTimer);
  feedbackTimer = window.setTimeout(() => {
    syncDownloadState();
  }, 2500);
}

applyLang(currentLang);
setExportModeState();
updatePreviewBackground();
validateAndRender();

async function validateAndRender() {
  const code = editor.value.trim();
  const token = ++latestRenderToken;

  if (!code) {
    currentIsValid = false;
    currentSyntaxState = "waiting";
    syncDownloadState();
    refreshDynamicText();
    previewFrame.innerHTML = `<div class="empty-state"><p>${t("emptyStateNoCode")}</p></div>`;
    errorBox.hidden = true;
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
    currentSyntaxState = "ok";
    syncDownloadState();
    refreshDynamicText();
  } catch (error) {
    if (token !== latestRenderToken) {
      return;
    }

    currentIsValid = false;
    currentSyntaxState = "error";
    syncDownloadState();
    refreshDynamicText();
    previewFrame.innerHTML = `<div class="empty-state"><p>${t("emptyStateSyntaxError")}</p></div>`;
    errorBox.hidden = false;
    errorBox.textContent = formatError(error);
  }
}

function refreshDynamicText() {
  const syntaxMap = {
    waiting: "statusWaiting",
    checking: "statusChecking",
    rerendering: "statusRerendering",
    sampleLoading: "statusSampleLoading",
    ok: "statusSyntaxOk",
    error: "statusSyntaxError",
  };
  const exportMap = {
    ready: "statusExportReady",
    mode: "statusExportMode",
    missing: "statusExportLibMissing",
  };

  if (currentSyntaxState === "ok") {
    syntaxStatus.textContent = t("statusSyntaxOk");
    syntaxStatus.className = "status-pill status-ok";
  } else if (currentSyntaxState === "error") {
    syntaxStatus.textContent = t("statusSyntaxError");
    syntaxStatus.className = "status-pill status-error";
  } else {
    syntaxStatus.textContent = t(syntaxMap[currentSyntaxState] ?? "statusWaiting");
    syntaxStatus.className = "status-pill status-idle";
  }

  const exportKey = exportMap[currentExportState] ?? "statusExportReady";
  exportStatus.textContent = t(exportKey);
  exportStatus.className =
    currentExportState === "mode"
      ? "status-pill status-ok"
      : currentExportState === "missing"
        ? "status-pill status-error"
        : "status-pill status-idle";

  downloadButton.title = exportAvailable ? t("downloadTooltip") : t("helperExportLibMissing");
}

function setExportModeState() {
  exportAvailable = typeof window.PptxGenJS === "function";
  currentExportState = exportAvailable ? "mode" : "missing";
  syncDownloadState();
  refreshDynamicText();
}

function syncDownloadState() {
  downloadButton.disabled = isExporting || !(currentIsValid && exportAvailable);
  if (!isExporting) {
    downloadButton.textContent = t("downloadButton");
  }
  downloadButton.title = exportAvailable ? t("downloadTooltip") : t("helperExportLibMissing");
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

  return t("parseFailed");
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
