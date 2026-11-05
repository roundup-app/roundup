import { copy as sharedCopy } from "../sharedCopy";
import { copy as keysCopy } from "../keys/copy";

const FEEDBACK = "Feedback";

export const copy = {
  title: FEEDBACK,
  line: "What feels wrong?",
  shotAlt: "Window shot",
  removeShot: "Remove the shot",
  noShot: (cause: string) => `No shot: ${cause}`,
  noCapture: "Capture unavailable",
  facts: "Sent with it",
  send: keysCopy.sendFeedback,
  close: sharedCopy.close,
  /** @prose */
  posted: "Your report is posted. Select to open it.",
  /** @prose */
  keptRetry: (folder: string) => `Your report is in ${folder}. Select to retry.`,
  /** @prose */
  notSent: "Your report was not sent.",
  setting: "Feedback Issue",
  /** @prose */
  settingHint: "The Issue that receives each report, as a GitHub URL.",
  /** @prose */
  settingInvalid: "Enter an Issue URL.",
  group: FEEDBACK,
} as const;
