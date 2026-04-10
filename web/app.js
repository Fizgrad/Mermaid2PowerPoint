import mermaid from "./vendor/mermaid/mermaid.esm.min.mjs";

const DOWNLOAD_BUTTON_LABEL = "生成可编辑 PPT";
const STATIC_PREVIEW_BUTTON_LABEL = "Pages 上仅预览";
const READY_TO_EXPORT_MESSAGE = "语法已通过；当前图可以导出成真正可编辑的 PPT。";
const WAIT_FOR_VALIDATION_MESSAGE = "先通过语法检查后才允许导出。";
const OFFLINE_EXPORT_MESSAGE =
  "GitHub Pages 是静态站点，没有导出后端。要导出可编辑 PPT，请本地运行 npm run dev。";

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
const backendStatus = document.querySelector("#backend-status");
const themeSelect = document.querySelector("#theme-select");
const backgroundInput = document.querySelector("#background-input");
const fileNameInput = document.querySelector("#filename-input");
const downloadButton = document.querySelector("#download-button");
const sampleButton = document.querySelector("#sample-button");
const helperText = document.querySelector("#helper-text");

let latestRenderToken = 0;
let currentIsValid = false;
let backendAvailable = false;

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

sampleButton.addEventListener("click", () => {
  editor.value = sampleDiagram;
  setIdleState("载入示例后重新渲染中…");
  validateAndRender();
});

downloadButton.addEventListener("click", async () => {
  if (!currentIsValid) {
    return;
  }

  downloadButton.disabled = true;
  downloadButton.textContent = "正在生成…";
  helperText.textContent = "后端正在把 Mermaid 渲染成 SVG，再转换成可编辑 PPT。";

  try {
    const response = await fetch(resolveApiUrl("api/export"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        background: backgroundInput.value,
        fileName: fileNameInput.value,
        mermaidCode: editor.value,
        theme: themeSelect.value,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "导出失败。" }));
      throw new Error(payload.error || "导出失败。");
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = normalizeFileName(fileNameInput.value);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(downloadUrl);

    helperText.textContent = "PPT 已生成。下载文件里是可编辑的原生 shape/text。";
  } catch (error) {
    helperText.textContent = error instanceof Error ? error.message : "导出失败。";
  } finally {
    syncDownloadState();
  }
});

validateAndRender();
checkBackendAvailability();

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
    helperText.textContent = backendAvailable ? READY_TO_EXPORT_MESSAGE : OFFLINE_EXPORT_MESSAGE;
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

async function checkBackendAvailability() {
  backendStatus.textContent = "检查导出服务中";
  backendStatus.className = "status-pill status-idle";

  try {
    const response = await fetch(resolveApiUrl("api/health"), {
      cache: "no-store",
    });
    backendAvailable = response.ok;
  } catch {
    backendAvailable = false;
  }

  if (backendAvailable) {
    backendStatus.textContent = "导出服务在线";
    backendStatus.className = "status-pill status-ok";
    helperText.textContent = currentIsValid
      ? READY_TO_EXPORT_MESSAGE
      : WAIT_FOR_VALIDATION_MESSAGE;
  } else {
    backendStatus.textContent = "仅静态预览模式";
    backendStatus.className = "status-pill status-offline";
    helperText.textContent = OFFLINE_EXPORT_MESSAGE;
  }

  syncDownloadState();
}

function syncDownloadState() {
  downloadButton.disabled = !(currentIsValid && backendAvailable);
  downloadButton.textContent = backendAvailable
    ? DOWNLOAD_BUTTON_LABEL
    : STATIC_PREVIEW_BUTTON_LABEL;
  downloadButton.title = backendAvailable
    ? "将当前 Mermaid 导出成可编辑的 PowerPoint 文件。"
    : OFFLINE_EXPORT_MESSAGE;
}

function resolveApiUrl(path) {
  return new URL(path, window.location.href).toString();
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

function debounce(fn, waitMs) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      fn(...args);
    }, waitMs);
  };
}
