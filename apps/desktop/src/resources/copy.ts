import { copy as sharedCopy, type CopyValue } from "../sharedCopy";

export const copy = {
  resources: sharedCopy.resources,
  resourcesLoading: "Loading resources…",
  resourcesEmpty: "No resource measurements for this Agent",
  close: sharedCopy.close,
  notUpdating: "Not updating",
  kilobyteUnit: "KB",
  megabyteUnit: "MB",
  gigabyteUnit: "GB",
  terabyteUnit: "TB",
  bytes: (value1: CopyValue) => `${value1} B`,
  percent: (value: number) => `${value}%`,
  counted: (value: string | number, noun: string) => `${value} ${noun}`,
  missing: "–",
} as const;
