import { copy as sharedCopy, type CopyValue } from "../sharedCopy";

export const copy = {
  close: sharedCopy.close,
  needsYou: sharedCopy.needsYou,
  toastLine: (value1: CopyValue, value2: CopyValue) => `${value1}: ${value2}`,
  toastsRegion: "Updates",
  toastOverflow: (value1: CopyValue) => `And ${value1} more`,
  changedTodo: sharedCopy.changedTodo,
} as const;
