import { Tip } from "../ui/Tip";
import { copy } from "../copy";
import { createSignal, For, Show } from "solid-js";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { ErrorLine } from "../ink/ErrorLine";
import { Popover } from "../ui/Popover";
import { NoteForm } from "./NoteForm";
import type { NoteFormDraft } from "./notes";
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

  return <Show when={props.notes.list(props.id).length || status() || props.notes.problem()}>
    <section class="note-batch" aria-label={copy.notesRegion}>
      <Show when={props.notes.problem()}>{message => <ErrorLine message={message()} />}</Show>
      <Show when={props.notes.list(props.id).length}>
        <ul aria-label={copy.notes}><For each={props.notes.list(props.id)}>{(note, index) => <li>
          <Tip text={note.comparison.newPath}>{(trigger) => <p class="note-path" {...trigger()} style={{ width: "fit-content", "max-width": "100%" }}>{note.comparison.newPath}</p>}</Tip>
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


/** Project-local access stays available when the original Agent or Worktree is gone. */
export const NoteRecovery = (props: { notes: Notes; available: (id: string) => boolean }) => {
  const [open, setOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<{ id: string; form: NoteFormDraft }>();
  const [failure, setFailure] = createSignal<string | null>(null);
  let trigger: HTMLButtonElement | undefined;
  const close = () => { setOpen(false); setEditing(undefined); trigger?.focus(); };

  const copyValue = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setFailure(null); }
    catch { setFailure(copy.copyFailedTheSystemClipboardRefusedItPress); }
  };

  const any = () => props.notes.entries().some(([, value]) => value.notes.length || value.forms.length || value.submissions.length || value.recovered.length) || props.notes.problem();

  return <Show when={any()}><Popover.Root open={open()} onOpenChange={({ open: next }) => { if (next) setOpen(true); else close(); }} closeOnEscape positioning={{ placement: "top-end", strategy: "fixed" }}>
    <Popover.Trigger asChild={attributes => <button {...attributes()} ref={element => { trigger = element; }} type="button" data-button="quiet">{copy.recoverNotes}</button>} />
    <Popover.Positioner><Popover.Content class="worktree-panel note-recovery" aria-label={copy.recoverNotes}>
      <div class="diff-actions"><button type="button" data-button="quiet" onClick={close}>{copy.close}</button></div>
      <Show when={props.notes.problem()}>{message => <ErrorLine message={message()} />}</Show>
      <Show when={failure()}>{message => <ErrorLine message={message()} />}</Show>
      <div class="diff-actions"><button type="button" data-button="quiet" onClick={() => void copyValue(props.notes.copy())}>{copy.copy}</button><button type="button" data-button="quiet" onClick={props.notes.retry}>{copy.retry}</button></div>
      <Show when={editing()} keyed>{value => <NoteForm id={value.id} comparison={value.form.comparison} notes={props.notes} recovered={value.form} selection={{ side: value.form.side, start: Number(value.form.start), end: Number(value.form.end) }} close={() => setEditing(undefined)} />}</Show>
      <For each={props.notes.entries()}>{([id, value]) => <section class="note-batch">
        <p>{copy.noteDraftStatus(id, props.notes.project)}</p>
        <Show when={!props.available(id)}><p role="status">{copy.originalRecipientUnavailable}</p></Show>
        <For each={value.forms}>{form => <div>
          <p>{form.comparison.newPath}{copy.originalContext}</p><p class="note-text">{form.text}</p>
          <div class="diff-actions"><button type="button" data-button="quiet" onClick={() => void copyValue(JSON.stringify({ project: props.notes.project, recipient: id, form }, null, 2))}>{copy.copy}</button><Show when={props.available(id)}><button type="button" data-button="quiet" onClick={() => setEditing({ id, form })}>{copy.resumeNote}</button></Show><button type="button" data-button="quiet" onClick={() => { props.notes.discardForm(id, form.revision); setEditing(undefined); }}>{copy.discardDraft}</button></div>
        </div>}</For>
        <For each={value.notes}>{note => <div>
          <p>{note.comparison.newPath}{copy.originalContext}</p><p class="note-text">{note.text}</p>
          <div class="diff-actions"><button type="button" data-button="quiet" onClick={() => void copyValue(JSON.stringify({ project: props.notes.project, recipient: id, note }, null, 2))}>{copy.copy}</button><button type="button" data-button="quiet" onClick={() => props.notes.remove(id, note.id)}>{copy.discardDraft}</button></div>
        </div>}</For>
        <For each={value.recovered}>{recovered => <div><p>{copy.originalContext}</p><pre class="note-text">{JSON.stringify(recovered.data, null, 2)}</pre><div class="diff-actions"><button type="button" data-button="quiet" onClick={() => void copyValue(JSON.stringify({ project: props.notes.project, recipient: id, ...recovered }, null, 2))}>{copy.copy}</button><button type="button" data-button="quiet" onClick={() => props.notes.discardRecovered(id, recovered.revision)}>{copy.discardDraft}</button></div></div>}</For>
        <For each={value.submissions}>{submission => <div>
          <p role="status">{copy.noteDraftStatus(id, submission.status)} {submission.text}</p><pre class="note-text">{submission.body}</pre>
          <div class="diff-actions"><button type="button" data-button="quiet" onClick={() => void copyValue(submission.body)}>{copy.copy}</button><Show when={submission.status === "unknown"}><button type="button" data-button="quiet" onClick={() => void props.notes.reconcile(id)}>{copy.checkMessageHistory}</button></Show><Show when={submission.status !== "pending"}><button type="button" data-button="quiet" onClick={() => props.notes.discardSubmission(id, submission.revision)}>{copy.discardSubmission}</button></Show></div>
        </div>}</For>
      </section>}</For>
      <For each={props.notes.invalid()}>{draft => <div><pre class="note-text">{JSON.stringify(draft.value)}</pre><div class="diff-actions"><button type="button" data-button="quiet" onClick={() => void copyValue(JSON.stringify(draft))}>{copy.copy}</button><button type="button" data-button="quiet" onClick={() => props.notes.discardInvalid(draft.revision)}>{copy.discardDraft}</button></div></div>}</For>
    </Popover.Content></Popover.Positioner>
  </Popover.Root></Show>;
};
