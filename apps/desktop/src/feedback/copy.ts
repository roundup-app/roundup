import { copy as sharedCopy } from "../sharedCopy";

const FEEDBACK = sharedCopy.feedback;

export const copy = {
  title: FEEDBACK,
  line: "What feels wrong?",
  shotAlt: "Window shot",
  removeShot: "Remove the shot",
  noShot: (cause: string) => `No shot: ${cause}`,
  noCapture: "Capture unavailable. Allow Screen Recording for roundup in macOS Privacy settings",
  facts: "Sent with it",
  log: (count: number) => `Log, ${count} lines`,
  send: "Send report",
  close: sharedCopy.close,
  /** @prose */
  posted: "Your report is posted. Select to open it.",
  /** @prose */
  keptRetry: (folder: string) => `Kept in ${folder}. Select to retry.`,
  /** @prose */
  notSent: "Your report was not sent.",
  noCommit: "no commit",
  service: "Service",
  up: "up",
  project: sharedCopy.project,
  selected: "Selected",
  none: "none",
} as const;
