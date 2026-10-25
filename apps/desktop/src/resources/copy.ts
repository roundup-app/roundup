type CopyValue = string | number | undefined;

import { copy as shared } from "../sharedCopy";

/** App-authored copy owned by this surface (U471). */
export const copy = {
  percent: shared.percent,
  notUpdating: "Not updating",
  missing: "–",
  kilobyteUnit: "KB",
  megabyteUnit: "MB",
  gigabyteUnit: "GB",
  terabyteUnit: "TB",
  bytes: (value1: CopyValue) => `${value1} B`,
  counted: shared.counted,
} as const;
