import type { ColorValue, PointPx } from "./types.js";

const COLOR_NAMES: Record<string, string> = {
  black: "000000",
  blue: "0000FF",
  gray: "808080",
  green: "008000",
  grey: "808080",
  red: "FF0000",
  white: "FFFFFF",
  yellow: "FFFF00",
};

export function pxToIn(px: number): number {
  return px / 96;
}

export function pxToPt(px: number): number {
  return (px * 72) / 96;
}

export function parseNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const match = stripCssPriority(value).match(/-?\d*\.?\d+/);
  if (!match) {
    return undefined;
  }

  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseTranslate(transform: string | undefined): PointPx {
  if (!transform) {
    return { x: 0, y: 0 };
  }

  const translatePattern = /translate\(\s*(-?\d*\.?\d+)(?:[\s,]+(-?\d*\.?\d+))?\s*\)/g;
  let match: RegExpExecArray | null;
  let x = 0;
  let y = 0;

  while ((match = translatePattern.exec(transform)) !== null) {
    x += Number.parseFloat(match[1]);
    y += match[2] ? Number.parseFloat(match[2]) : 0;
  }

  return { x, y };
}

export function parsePoints(pointsAttr: string | undefined): PointPx[] {
  if (!pointsAttr) {
    return [];
  }

  const values = pointsAttr.match(/-?\d*\.?\d+/g) ?? [];
  const points: PointPx[] = [];

  for (let index = 0; index < values.length - 1; index += 2) {
    points.push({
      x: Number.parseFloat(values[index]),
      y: Number.parseFloat(values[index + 1]),
    });
  }

  return points;
}

export function parseColor(raw: string | undefined): ColorValue | undefined {
  if (!raw) {
    return undefined;
  }

  const value = stripCssPriority(raw).toLowerCase();
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
    const clampByte = (input: string): number => Math.max(0, Math.min(255, Number.parseInt(input, 10)));

    return {
      hex: [clampByte(r), clampByte(g), clampByte(b)]
        .map((channel) => channel.toString(16).padStart(2, "0").toUpperCase())
        .join(""),
      transparency: clampTransparency((1 - Math.max(0, Math.min(alpha, 1))) * 100),
    };
  }

  const hslMatch = value.match(
    /^hsla?\(\s*(-?\d*\.?\d+)(?:deg)?\s*[, ]\s*(\d*\.?\d+)%\s*[, ]\s*(\d*\.?\d+)%(?:\s*[,/]\s*(\d*\.?\d+%?))?\s*\)$/
  );
  if (hslMatch) {
    const [, hueRaw, saturationRaw, lightnessRaw, alphaRaw] = hslMatch;
    const alpha = alphaRaw === undefined
      ? 1
      : alphaRaw.endsWith("%")
        ? Number.parseFloat(alphaRaw) / 100
        : Number.parseFloat(alphaRaw);

    return {
      hex: hslToHex(
        Number.parseFloat(hueRaw),
        Number.parseFloat(saturationRaw),
        Number.parseFloat(lightnessRaw)
      ),
      transparency: clampTransparency((1 - Math.max(0, Math.min(alpha, 1))) * 100),
    };
  }

  if (value in COLOR_NAMES) {
    return { hex: COLOR_NAMES[value], transparency: 0 };
  }

  return undefined;
}

export function normalizeWhitespace(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function stripCssPriority(value: string): string {
  return value.replace(/\s*!important\s*/gi, "").trim();
}

export function clampTransparency(input: number | undefined): number {
  if (input === undefined || Number.isNaN(input)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(input)));
}

export function estimateTextBox(text: string, fontSizePx = 16): { width: number; height: number } {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const effectiveLines = lines.length > 0 ? lines : [text];
  const longestLine = effectiveLines.reduce((max, line) => Math.max(max, line.length), 0);

  return {
    width: Math.max(12, longestLine * fontSizePx * 0.62),
    height: Math.max(fontSizePx * 1.4, effectiveLines.length * fontSizePx * 1.35),
  };
}

export function parsePathEndpoints(d: string | undefined): PointPx[] {
  if (!d) {
    return [];
  }

  const commands = d.match(/[MLCQ][^MLCQ]*/gi) ?? [];
  const points: PointPx[] = [];

  for (const command of commands) {
    const numbers = command.match(/-?\d*\.?\d+/g)?.map((value) => Number.parseFloat(value)) ?? [];
    if (numbers.length < 2) {
      continue;
    }

    const point = {
      x: numbers[numbers.length - 2],
      y: numbers[numbers.length - 1],
    };

    if (points.length === 0 || points[points.length - 1].x !== point.x || points[points.length - 1].y !== point.y) {
      points.push(point);
    }
  }

  return points;
}

export function withFallback<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback;
}

export function tintColor(color: ColorValue, amount: number): ColorValue {
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

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = Math.max(0, Math.min(1, saturation / 100));
  const l = Math.max(0, Math.min(1, lightness / 100));

  if (s === 0) {
    const channel = Math.round(l * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase();
    return `${channel}${channel}${channel}`;
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channels = [h + 1 / 3, h, h - 1 / 3].map((offset) => hueToRgbChannel(p, q, offset));
  return channels
    .map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0").toUpperCase())
    .join("");
}

function hueToRgbChannel(p: number, q: number, t: number): number {
  let normalized = t;
  if (normalized < 0) {
    normalized += 1;
  }
  if (normalized > 1) {
    normalized -= 1;
  }
  if (normalized < 1 / 6) {
    return p + (q - p) * 6 * normalized;
  }
  if (normalized < 1 / 2) {
    return q;
  }
  if (normalized < 2 / 3) {
    return p + (q - p) * (2 / 3 - normalized) * 6;
  }
  return p;
}
