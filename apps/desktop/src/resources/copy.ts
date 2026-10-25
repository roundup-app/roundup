/** App-authored resources copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

import type { CopyValue } from "../sharedCopy";

export const copy = {
  percent: shared.percent,
  counted: shared.counted,
  notUpdating: "Not updating",
  kilobyteUnit: "KB",
  megabyteUnit: "MB",
  gigabyteUnit: "GB",
  terabyteUnit: "TB",
  bytes: (value1: CopyValue) => `${value1} B`,
  missing: "–",
} as const;
