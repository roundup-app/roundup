import { copy } from "./copy";
import type { FeedbackReport } from "../app/seam";

/** U7210b: the versions line the dialog shows and the Daemon files under the text; herdr-core's part is left out when no core answered. */
export const versionsText = (
  facts: FeedbackReport["facts"] | null,
  herdrCore: string | undefined,
): string =>
  [
    facts
      ? `roundup ${facts.version} (${facts.commit || copy.noCommit})`
      : "roundup",
    herdrCore ? `herdr-core ${herdrCore}` : null,
    `macOS ${facts?.macos || copy.unknown}`,
  ]
    .filter(Boolean)
    .join(" · ");
