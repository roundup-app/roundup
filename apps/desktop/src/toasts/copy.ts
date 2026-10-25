type CopyValue = string | number | undefined;

import { copy as shared } from "../sharedCopy";

/** App-authored copy owned by this surface (U471). */
export const copy = {
  close: shared.close,
  needsYou: shared.needsYou,
  toastsRegion: "Updates",
  toastOverflow: (value1: CopyValue) => `And ${value1} more`,
  toastLine: shared.toastLine,
  thatIsGone: "That is gone",
  failedStatus: shared.toolCallFailed,
  changedTodo: shared.changedTodo,
  changedPad: (value1: CopyValue) => `Changed Pad ${value1}`,
} as const;
