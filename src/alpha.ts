export type AlphaErrorCode = 'INVALID_OPTIONS' | 'INVALID_INPUT' | 'INPUT_LIMIT' | 'TOOL_UNAVAILABLE' |
  'PROBE_FAILED' | 'INVALID_PROBE' | 'NO_VIDEO' | 'UNSUPPORTED_CODEC' | 'DECODE_FAILED' |
  'NO_FRAME' | 'OUTPUT_LIMIT' | 'TIMEOUT' | 'ABORTED';

export class AlphaInspectionError extends Error {
  readonly code: AlphaErrorCode;
  constructor(code: AlphaErrorCode, message: string) {
    super(message);
    this.name = 'AlphaInspectionError';
    this.code = code;
  }
}

export interface AlphaThresholds {
  /** A pixel counts as transparent when alpha < this value. Default 245. */
  transparentBelow?: number;
  /** A pixel counts as visible when alpha > this value. Default 10. */
  visibleAbove?: number;
  /** Minimum fraction of pixels for significant transparency/visibility. Default 0.01. */
  minPixelFraction?: number;
}

export interface AlphaStatistics {
  pixels: number;
  min: number;
  max: number;
  mean: number;
  zeroPixels: number;
  opaquePixels: number;
  partialPixels: number;
  transparentPixels: number;
  visiblePixels: number;
  transparentFraction: number;
  visibleFraction: number;
  significantTransparency: boolean;
  significantVisibility: boolean;
}

export type Thresholds = Required<AlphaThresholds>;
export function invalid(message: string): never { throw new AlphaInspectionError('INVALID_OPTIONS', message); }
export function objectOptions(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Options must be an object.');
}
export function finite(value: number, min: number, max: number, name: string, integer = false): number {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    invalid(`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`);
  }
  return value;
}
export function thresholds(options: AlphaThresholds): Thresholds {
  objectOptions(options);
  const transparentBelow = finite(options.transparentBelow ?? 245, 1, 255, 'transparentBelow', true);
  const visibleAbove = finite(options.visibleAbove ?? 10, 0, 254, 'visibleAbove', true);
  if (visibleAbove >= transparentBelow) invalid('visibleAbove must be smaller than transparentBelow.');
  const minPixelFraction = finite(options.minPixelFraction ?? 0.01, Number.EPSILON, 1, 'minPixelFraction');
  return { transparentBelow, visibleAbove, minPixelFraction };
}

/** Analyze an 8-bit alpha plane (one byte per pixel), without modifying the input. */
export function analyzeAlphaPlane(plane: Uint8Array, options: AlphaThresholds = {}): AlphaStatistics {
  const limits = thresholds(options);
  if (!(plane instanceof Uint8Array) || plane.length === 0 || plane.length > 16_777_216) {
    throw new AlphaInspectionError('INVALID_INPUT', 'Use a non-empty Uint8Array alpha plane up to 16,777,216 pixels.');
  }
  let min = 255, max = 0, total = 0, zeroPixels = 0, opaquePixels = 0;
  let transparentPixels = 0, visiblePixels = 0;
  for (const alpha of plane) {
    min = Math.min(min, alpha); max = Math.max(max, alpha); total += alpha;
    if (alpha === 0) zeroPixels++;
    if (alpha === 255) opaquePixels++;
    if (alpha < limits.transparentBelow) transparentPixels++;
    if (alpha > limits.visibleAbove) visiblePixels++;
  }
  const required = Math.max(1, Math.ceil(plane.length * limits.minPixelFraction));
  return {
    pixels: plane.length, min, max, mean: total / plane.length,
    zeroPixels, opaquePixels, partialPixels: plane.length - zeroPixels - opaquePixels,
    transparentPixels, visiblePixels,
    transparentFraction: transparentPixels / plane.length, visibleFraction: visiblePixels / plane.length,
    significantTransparency: transparentPixels >= required,
    significantVisibility: visiblePixels >= required,
  };
}
