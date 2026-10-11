/** What the strip knows of one open Project (U179); the App derives it from the tab and the Project's live Rail. */
export type StripTab = {
  path: string;
  name: string;
  /** `daemon exited <code>` once the Project's Daemon ended (U185). */
  exitText: string | null;
  needsYou: number;
  error: number;
  /** The names of the Agents running (Kind `working`, `needs-you` or `blocked`), in Rail order (U184). */
  running: string[];
};

export type Mark = "error" | "needs-you";

/** U180: `error` over `needs-you`; an exited Daemon is an error whatever its Agents' Kinds were (U185). */
export const markOf = (tab: StripTab): Mark | null => (tab.exitText !== null || tab.error > 0 ? "error" : tab.needsYou > 0 ? "needs-you" : null);

export const MARKS: Record<Mark, { character: string; label: string; tone: "red" | "amber" }> = {
  error: { character: "◉", label: "error", tone: "red" },
  "needs-you": { character: "●", label: "needs you", tone: "amber" },
};

/** U182: both counts always; an exited Daemon says so instead (U185). */
export const tipOf = (tab: StripTab): string => tab.exitText ?? `${tab.needsYou} need you · ${tab.error} error`;

/** U382: a name's last characters stay fixed, so when its start is clipped to `…` the characters that tell twins apart remain. */
const TAIL = 3;

export const nameParts = (name: string): [string, string] => {
  const chars = [...name];

  return chars.length <= 8 ? [name, ""] : [chars.slice(0, -TAIL).join(""), chars.slice(-TAIL).join("")];
};
