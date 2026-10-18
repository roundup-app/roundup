import { copy } from "../copy";
import { For, Show } from "solid-js";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { ErrorLine } from "../ink/ErrorLine";
import type { Note, Notes } from "./notes";

/** The keyboard-reachable batch remains available from the tree as well as the reader. */
export const NoteBatch = (props: { id: string; name: string; notes: Notes; comparison?: FileComparison | undefined; edit: (note: Note) => void }) => {
  const state = () => props.notes.state(props.id);

  const status = () => {
    const value = state();

    return value.kind === "pending" ? copy.submittingNotes : value.text;
  };

  const uncertain = () => state().kind === "unknown";
  const busy = () => state().kind === "pending" || uncertain();

  const older = (note: Note) => {
    const current = props.comparison;

    return current && current.newPath === note.comparison.newPath && (current.oldPath !== note.comparison.oldPath || current.base !== note.comparison.base || current.old.revision !== note.comparison.old.revision || current.new.revision !== note.comparison.new.revision);
  };

  return <Show when={props.notes.list(props.id).length || status()}>
    <section class="note-batch" aria-label={copy.notesRegion}>
      <Show when={props.notes.list(props.id).length}>
        <ul aria-label={copy.notes}><For each={props.notes.list(props.id)}>{(note, index) => <li>
          <p>{copy.noteLocation(note.comparison.newPath, note.side, note.start, note.end)}<Show when={older(note)}>{copy.originalContext}</Show></p>
          <p class="note-text">{note.text}</p>
          <div class="diff-actions">
            <button type="button" data-button="quiet" aria-label={copy.editNote(index() + 1)} onClick={() => props.edit(note)}>{copy.editNoteAction}</button>
            <button type="button" data-button="quiet" aria-label={copy.removeNote(index() + 1)} onClick={() => props.notes.remove(props.id, note.id)}>{copy.remove}</button>
          </div>
        </li>}</For></ul>
      </Show>
      <button type="button" data-button="quiet" disabled={busy() || props.notes.list(props.id).length === 0} onClick={() => void props.notes.send(props.id)}>{copy.sendNotesTo(props.name)}</button>
      <Show when={state().kind === "failed"} fallback={<p role="status">{status()}</p>}><ErrorLine message={status()} /></Show>
      <Show when={uncertain()}><button type="button" data-button="quiet" onClick={() => void props.notes.reconcile(props.id)}>{copy.checkMessageHistory}</button></Show>
    </section>
  </Show>;
};
