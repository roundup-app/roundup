/** App-authored toasts copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

import type { CopyValue } from "../sharedCopy";

export const copy = {
  close: shared.close,
  needsYou: shared.needsYou,

  toastLine: shared.toastLine,
  failedStatus: shared.toolCallFailed,
  changedTodo: shared.changedTodo,
  toastsRegion: "Updates",
  toastOverflow: (value1: CopyValue) => `And ${value1} more`,
  thatIsGone: "That is gone",
  changedPad: (value1: CopyValue) => `Changed Pad ${value1}`,
} as const;
