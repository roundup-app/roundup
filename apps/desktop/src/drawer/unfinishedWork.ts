import { createMemo } from "solid-js";
import { copy } from "../copy";
import { useConnectedProject } from "../state/connectedProject";
import { usePadList } from "../rail/pads/padList";

type Row = ReturnType<ReturnType<typeof useConnectedProject>["drafts"]["list"]>[number];

/** When each revision first qualified, kept across panel openings. */
const firstSeen = new Map<string, number>();

type Cause = "failed" | "unknown" | "draft" | "left" | "gone";

/** Fields that hold text the user typed; everything else is a pick (period, ids, revisions, a tick). */
const typed = new Set(["name", "title", "body", "text", "note", "document", "ask", "answer", "content", "message", "comment"]);

/** A credential draft's values are never rendered; Copy is their only exposure (U2773h). */
export const typedText = (draft: Row): string[] => Object.entries(draft.value)
  .filter(([field, value]) => (((typed.has(field) || (field === "source" && draft.destination.surface === "pads")) && !(field === "name" && draft.destination.surface === "ask")) || (draft.policy === "credential" && field === "password")) && String(value ?? "").trim() !== "")
  .map(([, value]) => String(value));

/**
 * The one eligibility for the Overview menu and the panel (U3021a, U3289a): work at risk only.
 * A draft whose editor is open is still being typed and never qualifies; one left or found at start does.
 * Unknown original availability never qualifies; a gone original does.
 */
export const useUnfinishedWork = () => {
  const { drafts, rail, daemonExit, decisions } = useConnectedProject();
  // Reading the Pad list costs an RPC; only a Pad draft needs it.
  const needsPads = createMemo(() => drafts.list().some((draft) => draft.destination.surface === "pads"));
  const padList = createMemo(() => needsPads() ? usePadList() : null);

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
      const cause: Cause | null = gone(draft) ? "gone" : draft.status === "failed" ? "failed" : draft.status === "unknown" ? "unknown" : unsaved ? "draft" : draft.status === "draft" ? "left" : null;

      if (cause === null) return [];

      if (!firstSeen.has(draft.revision)) firstSeen.set(draft.revision, Date.now());

      return [{ draft, cause, since: firstSeen.get(draft.revision)! }];
    });
  });

  // A Rail edit's problem is the Rail's own to show.
  return { rows, problem: () => drafts.problem()?.destination?.surface.startsWith("rail-") ? null : drafts.problem() };
};
