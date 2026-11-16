import { copy as sharedCopy } from "../sharedCopy";

export const copy = {
  title: "Send feedback",
  line: "What happened?",
  attach: "Attach screenshot",
  noShot: (cause: string) => `No screenshot: ${cause}`,
  noCapture:
    "Capture unavailable. Allow Screen Recording for roundup in macOS Privacy settings.",
  oldGh: "This gh is older than 2.103, so the screenshot is not sent.",
  noGh: "gh is not installed, so roundup cannot send this. Copy it and file it yourself.",
  signedOut:
    "gh is signed out, so roundup cannot send this. Copy it, or run gh auth login.",
  checking: "Checking gh…",
  /** @prose */
  needsText: "Write what happened first.",
  noCommit: "no commit",
  unknown: "unknown",
  send: sharedCopy.send,
  sending: "Sending…",
  copy: sharedCopy.copy,
  close: sharedCopy.close,
  /** @prose */
  filed: (number: number) => `Feedback sent as Issue #${number}`,
  /** @prose */
  openIssue: "Select to open it.",
  /** @prose */
  notSent: "Your feedback was not sent.",
} as const;
