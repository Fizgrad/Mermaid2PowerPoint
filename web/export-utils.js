const COLOR_NAMES = {
  black: "000000",
  blue: "0000FF",
  gray: "808080",
  green: "008000",
  grey: "808080",
  red: "FF0000",
  white: "FFFFFF",
  yellow: "FFFF00",
};

export function pxToIn(px) {
  return px / 96;
}

export function pxToPt(px) {
  return (px * 72) / 96;
}

export function parseNumber(value) {
  if (!value) {
    return undefined;
  }

  const match = stripCssPriority(String(value)).match(/-?\d*\.?\d+/);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseTranslate(transform) {
  if (!transform) {
    return { x: 0, y: 0 };
  }

  const translatePattern = /translate\(\s*(-?\d*\.?\d+)(?:[\s,]+(-?\d*\.?\d+))?\s*\)/g;
  let match;
  let x = 0;
  let y = 0;

  while ((match = translatePattern.exec(transform)) !== null) {
    x += Number.parseFloat(match[1]);
    y += match[2] ? Number.parseFloat(match[2]) : 0;
  }

  return { x, y };
}

export function parsePoints(pointsAttr) {
  if (!pointsAttr) {
    return [];
  }

  const values = String(pointsAttr).match(/-?\d*\.?\d+/g) ?? [];
  const points = [];

  for (let index = 0; index < values.length - 1; index += 2) {
    points.push({
      x: Number.parseFloat(values[index]),
      y: Number.parseFloat(values[index + 1]),
    });
  }

  return points;
}

export function parseColor(raw) {
  if (!raw) {
    return undefined;
  }

  const value = stripCssPriority(String(raw)).toLowerCase();
  if (!value || value === "none" || value === "transparent" || value === "currentcolor") {
    return undefined;
  }

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      return {
        hex: hex
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
          .toUpperCase(),
        transparency: 0,
      };
    }

    if (hex.length === 6) {
      return { hex: hex.toUpperCase(), transparency: 0 };
    }
  }

  const rgbMatch = value.match(
    /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})(?:\s*[,/]\s*(\d*\.?\d+))?\s*\)$/
  );
  if (rgbMatch) {
    const [, r, g, b, alphaRaw] = rgbMatch;
    const alpha = alphaRaw === undefined ? 1 : Number.parseFloat(alphaRaw);
    if (alpha <= 0) {
      return undefined;
    }

    const clampByte = (input) => Math.max(0, Math.min(255, Number.parseInt(input, 10)));
    return {
      hex: [clampByte(r), clampByte(g), clampByte(b)]
        .map((channel) => channel.toString(16).padStart(2, "0").toUpperCase())
        .join(""),
      transparency: clampTransparency((1 - Math.max(0, Math.min(alpha, 1))) * 100),
    };
  }

  if (value in COLOR_NAMES) {
    return { hex: COLOR_NAMES[value], transparency: 0 };
  }

  return undefined;
}

export function normalizeWhitespace(raw) {
  return String(raw).replace(/\s+/g, " ").trim();
}

export function stripCssPriority(value) {
  return String(value).replace(/\s*!important\s*/gi, "").trim();
}

export function clampTransparency(input) {
  if (input === undefined || Number.isNaN(input)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(input)));
}

export function estimateTextBox(text, fontSizePx = 16) {
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  const effectiveLines = lines.length > 0 ? lines : [String(text)];
  const longestLine = effectiveLines.reduce((max, line) => Math.max(max, line.length), 0);

  return {
    width: Math.max(12, longestLine * fontSizePx * 0.62),
    height: Math.max(fontSizePx * 1.4, effectiveLines.length * fontSizePx * 1.35),
  };
}

export function tintColor(color, amount) {
  const clamped = Math.max(0, Math.min(1, amount));
  const channels = [0, 2, 4].map((offset) => Number.parseInt(color.hex.slice(offset, offset + 2), 16));
  const tinted = channels.map((channel) =>
    Math.round(channel + (255 - channel) * clamped)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase()
  );

  return {
    hex: tinted.join(""),
    transparency: color.transparency,
  };
}

export function parseDashPattern(strokeDasharray) {
  if (!strokeDasharray || strokeDasharray === "none") {
    return "solid";
  }

  const values = String(strokeDasharray)
    .split(/[,\s]+/)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (values.length === 0) {
    return "solid";
  }

  if (values[0] <= 2) {
    return "dot";
  }

  return "dash";
}

export function resolveShapeStyle(element) {
  const style = window.getComputedStyle(element);
  const fill = parseRenderableColor(style.fill || style.backgroundColor);
  const strokeWidthPx = parseNumber(style.strokeWidth) ?? 0;
  const stroke = strokeWidthPx > 0 ? parseRenderableColor(style.stroke) : undefined;

  return {
    fill,
    stroke,
    strokeWidthPx: stroke ? strokeWidthPx : undefined,
    dashPattern: parseDashPattern(style.strokeDasharray),
  };
}

export function resolveTextBoxStyle(element) {
  if (!element) {
    return undefined;
  }

  const style = window.getComputedStyle(element);
  const fill = parseRenderableColor(style.backgroundColor || style.fill);
  const strokeWidthPx = parseNumber(style.strokeWidth) ?? 0;
  const stroke = strokeWidthPx > 0 ? parseRenderableColor(style.stroke) : undefined;

  if (!fill && !stroke) {
    return undefined;
  }

  return {
    fill,
    stroke,
    strokeWidthPx: stroke ? strokeWidthPx : undefined,
    dashPattern: parseDashPattern(style.strokeDasharray),
  };
}

export function resolveTextStyle(element) {
  const style = window.getComputedStyle(element);
  return {
    color: parseRenderableColor(style.color) ?? parseRenderableColor(style.fill),
    fontFamily: style.fontFamily,
    fontSizePx: parseNumber(style.fontSize),
    align: parseTextAlign(style.textAlign, style.textAnchor),
  };
}

export function parseTextAlign(textAlign, textAnchor) {
  if (textAnchor?.trim() === "middle") {
    return "center";
  }

  if (textAlign?.trim() === "center") {
    return "center";
  }

  if (textAlign?.trim() === "right" || textAlign?.trim() === "end") {
    return "right";
  }

  return "left";
}

export function parseRenderableColor(raw) {
  const color = parseColor(raw);
  if (!color || color.transparency >= 100) {
    return undefined;
  }

  return color;
}

export function decodeBase64Utf8(base64) {
  const binary = window.atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function safeGetBBox(element) {
  try {
    const box = element.getBBox();
    if (
      Number.isFinite(box.x) &&
      Number.isFinite(box.y) &&
      Number.isFinite(box.width) &&
      Number.isFinite(box.height)
    ) {
      return box;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
