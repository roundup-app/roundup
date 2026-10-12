/** U408: what the Resource strip prints for a missing, negative or non-finite value. */
const MISSING = "–";

const UNITS = ["KB", "MB", "GB", "TB"] as const;

const usable = (value: number | null | undefined): value is number => value !== null && value !== undefined && Number.isFinite(value) && value >= 0;

const halfUp = (value: number): number => Math.floor(value + 0.5);

/** U408: whole bytes in 1000-based units; one decimal below 100 and none from 100, a value that rounds to 1000 moving up a unit, `TB` the last. */
export const sizeText = (bytes: number | null | undefined): string => {
  if (!usable(bytes)) return MISSING;

  if (bytes < 1000) return `${halfUp(bytes)} B`;

  let unit = 0;
  let value = bytes / 1000;

  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }

  let rounded = halfUp(value * 10) / 10;

  if (rounded >= 100) rounded = halfUp(value);

  if (rounded >= 1000 && unit < UNITS.length - 1) {
    unit += 1;
    rounded = halfUp((value / 1000) * 10) / 10;
  }

  return `${rounded >= 100 ? rounded : rounded.toFixed(1)} ${UNITS[unit]}`;
};

/** U408: a whole percent of one core, rounded half up. */
export const cpuText = (percent: number | null | undefined): string => (usable(percent) ? `${halfUp(percent)}%` : MISSING);
