/** Each exchange brackets one Daemon clock reading on the webview clock. */
export type Exchange = { sent: number; daemon: number; received: number };

export type Calibration = { offset_ms: number; uncertainty_ms: number; resolution_ms: number; exchanges: Exchange[] };

/** Intersect the causal offset bounds, including timer quantization. Empty intersections expose clock drift rather than manufacturing precision. */
export const calibrate = (exchanges: Exchange[], resolution: number): Calibration | { error: string } => {
  if (exchanges.length < 2 || !Number.isFinite(resolution) || resolution <= 0) return { error: "invalid clock calibration" };
  let low = -Infinity;
  let high = Infinity;
  let previous = -Infinity;

  for (const { sent, daemon, received } of exchanges) {
    if (![sent, daemon, received].every(Number.isFinite) || sent < previous || sent > received) return { error: "invalid clock exchange" };
    previous = received;
    low = Math.max(low, daemon - received - resolution);
    high = Math.min(high, daemon - sent + resolution);
  }

  if (low > high) return { error: "clock calibration bounds disagree" };

  return { offset_ms: (low + high) / 2, uncertainty_ms: (high - low) / 2, resolution_ms: resolution, exchanges };
};
