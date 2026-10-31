import { copy as sharedCopy, type CopyValue } from "../sharedCopy";

export const copy = {
  close: sharedCopy.close,
  needsYou: sharedCopy.needsYou,
  toastLine: (value1: CopyValue, value2: CopyValue) => `${value1}: ${value2}`,
  toastsRegion: "Updates",
  toastOverflow: (value1: CopyValue) => `And ${value1} more`,
  thatIsGone: "That is gone",
  changedTodo: sharedCopy.changedTodo,
  changedPad: (value1: CopyValue) => `Changed Pad ${value1}`,
} as const;
