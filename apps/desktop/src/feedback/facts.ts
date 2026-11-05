import { copy } from "./copy";
import type { FeedbackReport } from "../app/seam";

export type Selection = { kind: string; name: string; state: string | null } | null;

/** FB3: the facts as the form shows them and the Daemon receives them: no environment value and no Terminal scrollback, only what the capture and the selection hold. */
export const factsText = (report: FeedbackReport | null, project: string, selection: Selection): string => {
  const lines = [
    report ? `roundup ${report.facts.version} (${report.facts.commit || copy.noCommit})` : "roundup",
    `macOS ${report?.facts.macos || "unknown"}`,
    `${copy.service}: ${copy.up}`,
    `${copy.project}: ${project.split("/").filter(Boolean).pop() ?? project}`,
    selection ? `${copy.selected}: ${selection.kind} ${selection.name}${selection.state ? ` (${selection.state})` : ""}` : `${copy.selected}: ${copy.none}`,
  ];

  return lines.join("\n");
};

/** The App log as the Daemon receives it after the facts; the form shows it behind a disclosure. */
export const logText = (report: FeedbackReport | null): string => report?.facts.log.length ? `${copy.log(report.facts.log.length)}\n${report.facts.log.join("\n")}` : "";

/** The text the Daemon receives: the facts, then the log. */
export const sentText = (report: FeedbackReport | null, project: string, selection: Selection): string => [factsText(report, project, selection), logText(report)].filter(Boolean).join("\n\n");
