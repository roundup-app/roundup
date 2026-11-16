export const copy = {
  title: "Send feedback",
  line: "What happened?",
  attach: "Attach a screenshot of this window",
  noShot: (cause: string) => `No screenshot: ${cause}`,
  noCapture:
    "Capture unavailable. Allow Screen Recording for roundup in macOS Privacy settings",
  oldGh: "This gh is older than 2.103, so the screenshot is not sent.",
  noGh: "gh is not installed, so roundup cannot send this. Copy it and file it yourself.",
  signedOut:
    "gh is signed out, so roundup cannot send this. Copy it, or run gh auth login.",
  checking: "Checking gh…",
  noCommit: "no commit",
  unknown: "unknown",
  send: "Send",
  sending: "Sending…",
  copy: "Copy",
  close: "Cancel",
  /** @prose */
  filed: (number: number) => `Feedback sent as Issue #${number}`,
  /** @prose */
  openIssue: "Select to open it.",
  /** @prose */
  notSent: "Your feedback was not sent.",
} as const;
