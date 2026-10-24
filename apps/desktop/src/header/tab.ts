import { copy } from "../copy";

/** What the strip knows of one open Project (U179); the App derives it from the tab and the Project's live Rail. */
export type StripTab = {
  path: string;
  name: string;
  /** Last authoritative name, distinct from an optimistic display name. */
  base?: string | undefined;
  /** `daemon exited <code>` once the Project's Daemon ended (U185). */
  exitText: string | null;
  needsYou: number;
  error: number;
  /** U3566b: an Agent of the Project finished a turn the user has not viewed. */
  unseen?: boolean;
  /** U181: the Project's Rail is not yet current, so neither is its Tab mark. */
  busy: boolean;
  /** The names of the Agents running (Kind `working`, `needs-you` or `blocked`), in Rail order (U184). */
  running: string[];
};

export type Mark = "error" | "needs-you";

/** U180: `error` over `needs-you`; an exited Daemon is an error whatever its Agents' Kinds were (U185). */
export const markOf = (tab: StripTab): Mark | null => (tab.exitText !== null || tab.error > 0 ? "error" : tab.needsYou > 0 ? "needs-you" : null);

export const MARKS: Record<Mark, { label: string; tone: "red" | "amber" }> = {
  error: { label: copy.error, tone: "red" },
  "needs-you": { label: copy.needsYou, tone: "amber" },
};

/** U182: both counts always; an exited Daemon says so instead (U185). */
export const tipOf = (tab: StripTab): string => tab.exitText ?? copy.needYouError(tab.needsYou, tab.error);

/** U382: a name's last characters stay fixed, so when its start is clipped to `…` the characters that tell twins apart remain. */
const TAIL = 3;

export const nameParts = (name: string): [string, string] => {
  const chars = Array.from(new Intl.Segmenter().segment(name), (part) => part.segment);

  return chars.length <= 8 ? [name, ""] : [chars.slice(0, -TAIL).join(""), chars.slice(-TAIL).join("")];
};
