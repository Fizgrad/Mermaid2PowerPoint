const TOKEN_PATTERN = /[AaCcHhLlMmQqSsTtVvZz]|-?(?:\d+\.\d+|\d+|\.\d+)(?:e[-+]?\d+)?/g;

export function parseSvgPathData(d) {
  if (!d) {
    return undefined;
  }

  const tokens = String(d).match(TOKEN_PATTERN);
  if (!tokens || tokens.length === 0) {
    return undefined;
  }

  const commands = [];
  const samples = [];
  let index = 0;
  let command = "";
  let current = { x: 0, y: 0 };
  let subpathStart = { x: 0, y: 0 };
  let previousCubicControl;
  let previousQuadraticControl;

  const hasNumberAt = (tokenIndex) =>
    tokenIndex < tokens.length && /^-?(?:\d+\.\d+|\d+|\.\d+)(?:e[-+]?\d+)?$/i.test(tokens[tokenIndex]);

  const readNumber = () => Number.parseFloat(tokens[index++]);
  const readPoint = (relative) => {
    const x = readNumber();
    const y = readNumber();
    return relative ? { x: current.x + x, y: current.y + y } : { x, y };
  };

  const pushSample = (...points) => {
    for (const point of points) {
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
        samples.push(point);
      }
    }
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (!token) {
      break;
    }

    if (/^[A-Za-z]$/.test(token)) {
      command = token;
      index += 1;
    } else if (!command) {
      break;
    }

    const lower = command.toLowerCase();
    const relative = command === lower;

    switch (lower) {
      case "m": {
        if (!hasNumberAt(index) || !hasNumberAt(index + 1)) {
          break;
        }

        const firstPoint = readPoint(relative);
        commands.push({ type: "moveTo", x: firstPoint.x, y: firstPoint.y });
        current = firstPoint;
        subpathStart = firstPoint;
        pushSample(firstPoint);
        previousCubicControl = undefined;
        previousQuadraticControl = undefined;

        while (hasNumberAt(index) && hasNumberAt(index + 1)) {
          const point = readPoint(relative);
          commands.push({ type: "lineTo", x: point.x, y: point.y });
          pushSample(point);
          current = point;
        }
        break;
      }
      case "l": {
        while (hasNumberAt(index) && hasNumberAt(index + 1)) {
          const point = readPoint(relative);
          commands.push({ type: "lineTo", x: point.x, y: point.y });
          pushSample(point);
          current = point;
        }
        previousCubicControl = undefined;
        previousQuadraticControl = undefined;
        break;
      }
      case "h": {
        while (hasNumberAt(index)) {
          const value = readNumber();
          const point = { x: relative ? current.x + value : value, y: current.y };
          commands.push({ type: "lineTo", x: point.x, y: point.y });
          pushSample(point);
          current = point;
        }
        previousCubicControl = undefined;
        previousQuadraticControl = undefined;
        break;
      }
      case "v": {
        while (hasNumberAt(index)) {
          const value = readNumber();
          const point = { x: current.x, y: relative ? current.y + value : value };
          commands.push({ type: "lineTo", x: point.x, y: point.y });
          pushSample(point);
          current = point;
        }
        previousCubicControl = undefined;
        previousQuadraticControl = undefined;
        break;
      }
      case "c": {
        while (hasNumberAt(index) && hasNumberAt(index + 5)) {
          const c1 = readPoint(relative);
          const c2 = readPoint(relative);
          const point = readPoint(relative);
          commands.push({
            type: "cubicTo",
            x1: c1.x,
            y1: c1.y,
            x2: c2.x,
            y2: c2.y,
            x: point.x,
            y: point.y,
          });
          pushSample(c1, c2, point);
          current = point;
          previousCubicControl = c2;
          previousQuadraticControl = undefined;
        }
        break;
      }
      case "s": {
        while (hasNumberAt(index) && hasNumberAt(index + 3)) {
          const reflected = previousCubicControl
            ? {
                x: current.x * 2 - previousCubicControl.x,
                y: current.y * 2 - previousCubicControl.y,
              }
            : { ...current };
          const c2 = readPoint(relative);
          const point = readPoint(relative);
          commands.push({
            type: "cubicTo",
            x1: reflected.x,
            y1: reflected.y,
            x2: c2.x,
            y2: c2.y,
            x: point.x,
            y: point.y,
          });
          pushSample(reflected, c2, point);
          current = point;
          previousCubicControl = c2;
          previousQuadraticControl = undefined;
        }
        break;
      }
      case "q": {
        while (hasNumberAt(index) && hasNumberAt(index + 3)) {
          const control = readPoint(relative);
          const point = readPoint(relative);
          commands.push({
            type: "quadraticTo",
            x1: control.x,
            y1: control.y,
            x: point.x,
            y: point.y,
          });
          pushSample(control, point);
          current = point;
          previousQuadraticControl = control;
          previousCubicControl = undefined;
        }
        break;
      }
      case "t": {
        while (hasNumberAt(index) && hasNumberAt(index + 1)) {
          const reflected = previousQuadraticControl
            ? {
                x: current.x * 2 - previousQuadraticControl.x,
                y: current.y * 2 - previousQuadraticControl.y,
              }
            : { ...current };
          const point = readPoint(relative);
          commands.push({
            type: "quadraticTo",
            x1: reflected.x,
            y1: reflected.y,
            x: point.x,
            y: point.y,
          });
          pushSample(reflected, point);
          current = point;
          previousQuadraticControl = reflected;
          previousCubicControl = undefined;
        }
        break;
      }
      case "a": {
        while (hasNumberAt(index) && hasNumberAt(index + 6)) {
          readNumber();
          readNumber();
          readNumber();
          readNumber();
          readNumber();
          const point = readPoint(relative);
          commands.push({ type: "lineTo", x: point.x, y: point.y });
          pushSample(point);
          current = point;
        }
        previousCubicControl = undefined;
        previousQuadraticControl = undefined;
        break;
      }
      case "z": {
        commands.push({ type: "close" });
        pushSample(subpathStart);
        current = { ...subpathStart };
        previousCubicControl = undefined;
        previousQuadraticControl = undefined;
        break;
      }
      default: {
        index = tokens.length;
        break;
      }
    }
  }

  if (commands.length === 0) {
    return undefined;
  }

  return {
    bounds: getBoundsFromPoints(samples),
    commands,
    hasCurves: commands.some((commandItem) => commandItem.type === "cubicTo" || commandItem.type === "quadraticTo"),
  };
}

export function geometryToPoints(geometry) {
  if (!geometry) {
    return [];
  }

  const points = [];
  for (const command of geometry.commands) {
    if (command.type === "moveTo" || command.type === "lineTo" || command.type === "quadraticTo" || command.type === "cubicTo") {
      const point = { x: command.x, y: command.y };
      const previous = points[points.length - 1];
      if (!previous || previous.x !== point.x || previous.y !== point.y) {
        points.push(point);
      }
    }
  }

  return points;
}

export function unionBoundingBoxes(boxes) {
  if (boxes.length === 0) {
    return undefined;
  }

  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getBoundsFromPoints(points) {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
