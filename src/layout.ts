import type { Box } from "./model";

const MIN_SPREAD_RATIO = 1.2;
const GUTTER_SEARCH_START = 0.35;
const GUTTER_SEARCH_END = 0.65;
const MIN_GUTTER_RATIO = 0.018;
const INK_CONTRAST = 45;

export function pageRegions(
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
): Box[] {
  const whole = { x0: 0, y0: 0, x1: width, y1: height };
  if (width / height < MIN_SPREAD_RATIO) return [whole];
  const ink = new Uint32Array(width);
  const rowStep = Math.max(1, Math.floor(height / 500));
  for (let y = 0; y < height; y += rowStep) {
    const edge = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = edge + x * 4;
      if (
        [0, 1, 2].some(
          (channel) =>
            Math.abs(pixels[i + channel] - pixels[edge + channel]) >
            INK_CONTRAST,
        )
      )
        ink[x]++;
    }
  }
  const start = Math.floor(width * GUTTER_SEARCH_START);
  const end = Math.ceil(width * GUTTER_SEARCH_END);
  let runStart = start;
  const candidates: number[] = [];
  for (let x = start; x <= end; x++) {
    if (x < end && ink[x] === 0) continue;
    if (x - runStart >= width * MIN_GUTTER_RATIO)
      candidates.push(Math.round((runStart + x) / 2));
    runStart = x + 1;
  }
  const middle = candidates.sort(
    (a, b) => Math.abs(a - width / 2) - Math.abs(b - width / 2),
  )[0];
  if (!middle) return [whole];
  const occupied = (left: number, right: number) =>
    ink.slice(left, right).filter((count) => count > 2).length;
  if (
    occupied(0, middle) < width * 0.12 ||
    occupied(middle, width) < width * 0.12
  )
    return [whole];
  return [
    { ...whole, x1: middle },
    { ...whole, x0: middle },
  ];
}

export function imagePlacement(
  naturalWidth: number,
  naturalHeight: number,
  width: number,
  height: number,
  fit: string,
  position: string,
) {
  let scaleX = width / naturalWidth;
  let scaleY = height / naturalHeight;
  if (fit !== "fill") {
    const scale =
      fit === "cover"
        ? Math.max(scaleX, scaleY)
        : fit === "none"
          ? 1
          : fit === "scale-down"
            ? Math.min(1, scaleX, scaleY)
            : Math.min(scaleX, scaleY);
    scaleX = scaleY = scale;
  }
  const [horizontal = "50%", vertical = "50%"] = position.split(" ");
  const offset = (value: string, free: number) =>
    value.endsWith("%")
      ? (free * parseFloat(value)) / 100
      : parseFloat(value) || 0;
  return {
    scaleX,
    scaleY,
    x: offset(horizontal, width - naturalWidth * scaleX),
    y: offset(vertical, height - naturalHeight * scaleY),
  };
}
