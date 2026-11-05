import type { FeedbackReport } from "../app/seam";

export type Selection = { kind: string; name: string; state: string | null } | null;

/** FB3: the facts as the form shows them and the Daemon receives them: no environment value and no Terminal scrollback, only what the capture and the selection hold. */
export const factsText = (report: FeedbackReport | null, project: string, selection: Selection): string => {
  const lines = [
    report ? `roundup ${report.facts.version} (${report.facts.commit || "no commit"})` : "roundup",
    `macOS ${report?.facts.macos || "unknown"}`,
    "Daemon: up",
    `Project: ${project}`,
    selection ? `Selected: ${selection.kind} ${selection.name}${selection.state ? ` (${selection.state})` : ""}` : "Selected: none",
  ];

  if (report?.facts.log.length) lines.push("", `App log (last ${report.facts.log.length} lines):`, ...report.facts.log);

  return lines.join("\n");
};
