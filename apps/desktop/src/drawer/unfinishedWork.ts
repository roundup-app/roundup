import { createMemo } from "solid-js";
import { copy } from "../copy";
import { useConnectedProject } from "../state/connectedProject";
import { usePadList } from "../rail/pads/padList";

type Row = ReturnType<ReturnType<typeof useConnectedProject>["drafts"]["list"]>[number];

type Cause = "failed" | "unknown" | "draft" | "gone";

/** Fields that hold text the user typed; everything else is a pick (period, ids, revisions, a tick). */
const typed = new Set(["name", "title", "body", "text", "note", "document", "ask", "answer", "content", "message", "comment"]);

export const typedText = (draft: Row): string[] => Object.entries(draft.value)
  .filter(([field, value]) => typed.has(field) && String(value ?? "").trim() !== "")
  .map(([, value]) => String(value));

/**
 * The one eligibility for the Overview entry and the panel (U3021a): work at risk only.
 * Unknown original availability never qualifies; a gone original does.
 */
export const useUnfinishedWork = () => {
  const { drafts, rail, daemonExit, decisions } = useConnectedProject();
  // Reading the Pad list costs an RPC; only a Pad draft needs it.
  const needsPads = createMemo(() => drafts.list().some((draft) => draft.destination.surface === "pads"));
  const padList = createMemo(() => needsPads() ? usePadList() : null);
  const firstSeen = new Map<string, number>();

  const gone = (draft: Row) => {
    const { surface, object } = draft.destination;

    if (surface === "pads") {
      const pads = padList();

      return Boolean(draft.value.originalName) && pads !== null && pads.loaded() && !pads.failure() && !pads.pads().some((pad) => pad.incarnation === object);
    }

    if (surface === "orders" || surface === "rail") return !rail.nodes.some((node) => node.id === object);

    return drafts.availability(draft, { rail, daemonExit, decisions }) === "unavailable";
  };

  const rows = createMemo(() => {
    const problem = drafts.problem();
    const stored = problem?.operation === "retain";

    return drafts.recoverable().flatMap((draft) => {
      const { surface } = draft.destination;

      if (surface.startsWith("rail-") || !copy.hasDraftSurface(surface) || typedText(draft).length === 0) return [];

      const unsaved = stored && (problem.destination === null || (problem.destination.surface === surface && problem.destination.object === draft.destination.object));
      const cause: Cause | null = gone(draft) ? "gone" : draft.status === "failed" ? "failed" : draft.status === "unknown" ? "unknown" : unsaved ? "draft" : null;

      if (cause === null) return [];

      if (!firstSeen.has(draft.revision)) firstSeen.set(draft.revision, Date.now());

      return [{ draft, cause, since: firstSeen.get(draft.revision)! }];
    });
  });

  return { rows, problem: () => drafts.problem() };
};
