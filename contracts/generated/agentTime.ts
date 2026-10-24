// Generated from contracts::Kind::counts_time; do not edit.
import type { Kind } from './Kind';

const counts = {
  "error": [true, false],
  "needs-you": [true, false],
  "blocked": [true, false],
  "working": [true, false],
  "idle": [false, false],
  "done": [false, false]
};

export const countsTime = (kind: Kind, ended: boolean): boolean => counts[kind][ended ? 1 : 0]!;
