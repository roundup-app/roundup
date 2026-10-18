import { For, Show } from "solid-js";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { ErrorLine } from "../ink/ErrorLine";
import type { Note, Notes } from "./notes";

/** The keyboard-reachable batch remains available from the tree as well as the reader. */
export const NoteBatch = (props: { id: string; name: string; notes: Notes; comparison?: FileComparison | undefined; edit: (note: Note) => void }) => {
  const state = () => props.notes.state(props.id);

  const status = () => {
    const value = state();

    return value.kind === "pending" ? "Submitting notes…" : value.text;
  };

  const uncertain = () => state().kind === "unknown";
  const busy = () => state().kind === "pending" || uncertain();

  const older = (note: Note) => {
    const current = props.comparison;

    return current && current.newPath === note.comparison.newPath && (current.oldPath !== note.comparison.oldPath || current.base !== note.comparison.base || current.old.revision !== note.comparison.old.revision || current.new.revision !== note.comparison.new.revision);
  };

  return <Show when={props.notes.list(props.id).length || status()}>
    <section class="note-batch" aria-label="Agent notes">
      <Show when={props.notes.list(props.id).length}>
        <ul aria-label="Notes"><For each={props.notes.list(props.id)}>{(note, index) => <li>
          <p>{note.comparison.newPath} · {note.side} {note.start}–{note.end}<Show when={older(note)}> · Original context</Show></p>
          <p class="note-text">{note.text}</p>
          <div class="diff-actions">
            <button type="button" data-button="quiet" aria-label={`Edit note ${index() + 1}`} onClick={() => props.edit(note)}>Edit</button>
            <button type="button" data-button="quiet" aria-label={`Remove note ${index() + 1}`} onClick={() => props.notes.remove(props.id, note.id)}>Remove</button>
          </div>
        </li>}</For></ul>
      </Show>
      <button type="button" data-button="quiet" disabled={busy() || props.notes.list(props.id).length === 0} onClick={() => void props.notes.send(props.id)}>Send notes to {props.name}</button>
      <Show when={state().kind === "failed"} fallback={<p role="status">{status()}</p>}><ErrorLine message={status()} /></Show>
      <Show when={uncertain()}><button type="button" data-button="quiet" onClick={() => void props.notes.reconcile(props.id)}>Check Message history</button></Show>
    </section>
  </Show>;
};
