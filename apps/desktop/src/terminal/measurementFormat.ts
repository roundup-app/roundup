import prettyMilliseconds from "pretty-ms";
import { copy } from "../copy";

/** The top two units of a duration; unavailable is `—`, never zero. */
export const duration = (ns: string | null) => {
  if (ns === null) return copy.measurementUnknown;
  const ms = BigInt(ns) / 1_000_000n;

  if (ms < 1000n) return BigInt(ns) > 0n ? "<1s" : "0s";

  return prettyMilliseconds(Number(ms), { unitCount: 2, secondsDecimalDigits: 0 });
};

/** Whole percent of `part` in `whole`, `<1%` for a positive share under one percent. */
export const percent = (part: number, whole: number) => {
  if (!(whole > 0) || part < 0) return copy.measurementUnknown;
  const value = (part / whole) * 100;

  return value > 0 && value < 1 ? "<1%" : `${value < 100 ? Math.min(99, Math.round(value)) : Math.round(value)}%`;
};
