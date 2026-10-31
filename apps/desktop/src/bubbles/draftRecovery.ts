import * as v from "valibot";
import type { ConnectedProject } from "../state/connectedProject";

export const bubbleDraftSchema = v.strictObject({ name: v.string(), base: v.string(), recovery: v.optional(v.literal(true)) });

export const registerBubbleDrafts = (drafts: ConnectedProject["drafts"]): void => {
  drafts.validate("bubbles", bubbleDraftSchema);
  drafts.registerRecovery("bubbles", (draft, facts) => {
    return facts.daemonExit() !== null ? "unavailable" : facts.rail.failure() ? "unverified"
      : facts.rail.terminals().some(terminal => terminal.incarnation === draft.destination.object && terminal.id === draft.destination.recipient && terminal.running) ? "available" : "unavailable";
  });
};
