import { isDoor } from "../state/doorNode";
import { LEADER } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import { createEffect } from "solid-js";
import { copy } from "./copy";
import { useConnectedProject } from "../state/connectedProject";
import { ownedCount } from "./owned";
import { notesFor } from "./notes";
import { NoteRecovery } from "./NoteBatch";
import "./styles.css";

/** U2539b, U7671a: the bottom bar's note recovery, and the leader chord that opens the Changes view; no changed-file list of its own. */
export const WorktreeControl = (props: { compact?: boolean | undefined }) => {
  const { rail, app, project, drafts, owned, hasView, hideView, showView } = useConnectedProject();
  const notes = notesFor(app, project.path, drafts);
  const names = new Map<string, string>();

  createEffect(() => rail.nodes.map(node => [node.id, node.name] as const), entries => { for (const [id, name] of entries) names.set(id, name); });

  const recoveryOpen = () => hasView("notes");
  const setRecoveryOpen = (open: boolean) => { if (open) showView("notes"); else hideView("notes"); };

  // Offered only where the Changes view renders and the Rail icon shows: an Agent that owns files.
  registerKeys({ kind: "leader" }, [{ action: LEADER["leader.changes"], capture: () => ({ available: () => {
    const id = rail.selected();

    return id !== null && rail.nodes.some(node => node.id === id && node.kind === "agent") && ownedCount(owned.read(id)) > 0;
  }, invoke: () => showView("changes", "key") }) }]);

  return <NoteRecovery compact={props.compact} name={id => rail.nodes.find(node => node.id === id)?.name ?? names.get(id) ?? copy.unavailableAgent} notes={notes} open={recoveryOpen()} onOpenChange={setRecoveryOpen} available={id => rail.nodes.some(node => node.id === id && isDoor(node) && node.worktree !== null)} />;
};
