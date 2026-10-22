import { createCutTitle } from "../ui/cutTitle";
import { copy } from "../copy";
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { ErrorLine } from "../ink/ErrorLine";
import { Popover } from "../ui/Popover";
import { useConnectedProject } from "../state/connectedProject";
import { reply } from "./notes";
import { NoteForm } from "./NoteForm";
import type { NoteFormDraft } from "./notes";
import type { Note, Notes } from "./notes";

const olderComparison = (current: FileComparison | undefined, original: FileComparison) => current && current.newPath === original.newPath && (current.oldPath !== original.oldPath || current.base !== original.base || current.old.revision !== original.old.revision || current.new.revision !== original.new.revision);

const NotePath = (props: { path: string }) => {
  const cut = createCutTitle(() => props.path);

  return <p ref={cut.ref} title={cut.title()} class="note-path" style={{ width: "fit-content", "max-width": "100%" }}>{props.path}</p>;
};

/** The keyboard-reachable batch remains available from the tree as well as the reader. */
export const NoteBatch = (props: { id: string; name: string; notes: Notes; comparison?: FileComparison | undefined; edit: (note: Note) => void; recover: () => void }) => {
  const state = () => props.notes.state(props.id);

  const status = () => {
    const value = state();

    return value.kind === "pending" ? copy.submittingNotes : value.text;
  };

  const uncertain = () => state().kind === "unknown";
  const busy = () => state().kind === "pending" || uncertain();

  const older = (note: Note) => olderComparison(props.comparison, note.comparison);

  return <Show when={props.notes.list(props.id).length || status() || props.notes.problem()}>
    <section class="note-batch" aria-label={copy.notesRegion}>
      <Show when={props.notes.problem()}>{message => <><ErrorLine message={message()} /><button type="button" data-button="quiet" onClick={props.recover}>{copy.openNotesRecovery}</button></>}</Show>
      <Show when={props.notes.list(props.id).length}>
        <ul aria-label={copy.notes}><For each={props.notes.list(props.id)}>{(note, index) => <li>
          <NotePath path={note.comparison.newPath} />
          <p>{copy.noteLocation(note.comparison.newPath, note.side, note.start, note.end)}<Show when={older(note)}><span role="status">{copy.originalContext}</span></Show></p>
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
export const NoteRecovery = (props: { notes: Notes; available: (id: string) => boolean; name: (id: string) => string; open: boolean; onOpenChange: (open: boolean) => void }) => {
  const { app } = useConnectedProject();
  const [comparisons, setComparisons] = createSignal<ReadonlyMap<string, FileComparison>>(new Map());

  createEffect(on(() => props.open, open => {
    if (!open) return;
    let active = true;

    setComparisons(new Map());

    for (const [id, value] of props.notes.entries()) {
      if (!props.available(id)) continue;
      const paths = new Set([...value.forms, ...value.notes, ...value.submissions.flatMap(submission => submission.notes), ...value.recovered.flatMap(record => [...record.data.forms, ...record.data.notes])].map(note => note.comparison.newPath));

      for (const path of paths) void reply(() => app.rpc("agent.compareFile", { id, path })).then(result => {
        if (active && result.kind === "ok") setComparisons(previous => new Map(previous).set(`${id}:${path}`, result.value));
      });
    }

    onCleanup(() => { active = false; });
  }));

  const older = (id: string, comparison: FileComparison) => olderComparison(comparisons().get(`${id}:${comparison.newPath}`), comparison);

  const [editing, setEditing] = createSignal<{ id: string; form: NoteFormDraft }>();
  const [failure, setFailure] = createSignal<string | null>(null);
  let trigger: HTMLButtonElement | undefined;
  const close = () => { props.onOpenChange(false); setEditing(undefined); trigger?.focus(); };

  const copyValue = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setFailure(null); }
    catch { setFailure(copy.copyFailedTheSystemClipboardRefusedItPress); }
  };

  const any = () => props.notes.entries().some(([id, value]) => (!props.available(id) && (value.notes.length || value.forms.length || value.submissions.length)) || value.submissions.some(submission => submission.status !== "pending") || value.recovered.length) || props.notes.problem();

  createEffect(() => { if (!props.open) setEditing(undefined); });
  createEffect(() => { if (!props.notes.entries().length && !props.notes.problem()) props.onOpenChange(false); });

  return <Show when={any() || props.open}><Popover.Root open={props.open} onOpenChange={({ open: next }) => { if (next) props.onOpenChange(true); else close(); }} closeOnEscape positioning={{ placement: "top-end", strategy: "fixed" }}>
    <Popover.Trigger asChild={attributes => <button {...attributes()} ref={element => { trigger = element; }} type="button" data-button="quiet">{copy.recoverNotes}</button>} />
    <Popover.Positioner><Popover.Content class="worktree-panel note-recovery" aria-label={copy.recoverNotes}>
      <header class="diff-header"><span class="diff-identity">{copy.recoverNotes}</span><button type="button" data-button="quiet" onClick={close}>{copy.close}</button></header>
      <Show when={props.notes.problem()}>{message => <ErrorLine message={message()} />}</Show>
      <Show when={failure()}>{message => <ErrorLine message={message()} />}</Show>
      <div class="diff-actions"><button type="button" data-button="quiet" onClick={() => void copyValue(props.notes.copy())}>{copy.copy}</button><Show when={props.notes.problem()}><button type="button" data-button="quiet" onClick={props.notes.retry}>{copy.retry}</button></Show></div>
      <Show when={editing()} keyed>{value => <NoteForm id={value.id} comparison={comparisons().get(`${value.id}:${value.form.comparison.newPath}`) ?? value.form.comparison} notes={props.notes} recovered={value.form} selection={{ side: value.form.side, start: Number(value.form.start), end: Number(value.form.end) }} close={() => setEditing(undefined)} />}</Show>
      <For each={props.notes.entries()}>{([id, value]) => <section class="note-batch">
        <h3>{copy.noteDraftStatus(props.name(id), value.submissions[0]?.status ?? copy.noteDraft)}</h3>
        <Show when={!props.available(id)}><p role="status">{copy.originalRecipientUnavailable}</p></Show>
        <For each={value.forms}>{form => <div>
          <p class="note-path">{form.comparison.newPath}<Show when={older(id, form.comparison)}>{copy.originalContext}</Show></p><p>{copy.noteLocation(form.comparison.newPath, form.side, Number(form.start), Number(form.end))}</p><p class="note-text">{form.text}</p>
          <div class="diff-actions"><button type="button" data-button="quiet" onClick={() => void copyValue(JSON.stringify({ project: props.notes.project, recipient: id, form }, null, 2))}>{copy.copy}</button><Show when={props.available(id)}><button type="button" data-button="quiet" onClick={() => setEditing({ id, form })}>{copy.resumeNote}</button></Show><button type="button" data-button="quiet" onClick={() => { props.notes.discardForm(id, form.revision); setEditing(undefined); }}>{copy.discardDraft}</button></div>
        </div>}</For>
        <For each={value.notes}>{note => <div>
          <p class="note-path">{note.comparison.newPath}<Show when={older(id, note.comparison)}>{copy.originalContext}</Show></p><p>{copy.noteLocation(note.comparison.newPath, note.side, note.start, note.end)}</p><p class="note-text">{note.text}</p>
          <div class="diff-actions"><button type="button" data-button="quiet" onClick={() => void copyValue(JSON.stringify({ project: props.notes.project, recipient: id, note }, null, 2))}>{copy.copy}</button><button type="button" data-button="quiet" onClick={() => props.notes.remove(id, note.id)}>{copy.discardDraft}</button></div>
        </div>}</For>
        <For each={value.recovered}>{recovered => <div><RecordPreview older={comparison => older(id, comparison)} rows={[...recovered.data.forms, ...recovered.data.notes, ...recovered.data.submissions.flatMap(submission => submission.notes)]} /><div class="diff-actions"><button type="button" data-button="quiet" onClick={() => void copyValue(JSON.stringify({ project: props.notes.project, recipient: id, ...recovered }, null, 2))}>{copy.copy}</button><button type="button" data-button="quiet" onClick={() => props.notes.discardRecovered(id, recovered.revision)}>{copy.discardDraft}</button></div></div>}</For>
        <For each={value.submissions}>{submission => <div>
          <p role="status">{copy.noteDraftStatus(props.name(id), submission.status)} {submission.text}</p><RecordPreview older={comparison => older(id, comparison)} rows={submission.notes} />
          <div class="diff-actions"><button type="button" data-button="quiet" onClick={() => void copyValue(submission.body)}>{copy.copy}</button><Show when={submission.status === "unknown"}><button type="button" data-button="quiet" onClick={() => void props.notes.reconcile(id)}>{copy.checkMessageHistory}</button></Show><Show when={submission.status !== "pending"}><button type="button" data-button="quiet" onClick={() => props.notes.discardSubmission(id, submission.revision)}>{copy.discardSubmission}</button></Show></div>
        </div>}</For>
      </section>}</For>
      <For each={props.notes.invalid()}>{draft => <div><RecordPreview rows={draft.preview} /><div class="diff-actions"><button type="button" data-button="quiet" onClick={() => void copyValue(JSON.stringify(draft))}>{copy.copy}</button><button type="button" data-button="quiet" onClick={() => props.notes.discardInvalid(draft.revision)}>{copy.discardDraft}</button></div></div>}</For>
    </Popover.Content></Popover.Positioner>
  </Popover.Root></Show>;
};

/** Recovery uses the same path, range and text presentation as live notes. */
const RecordPreview = (props: { rows: readonly (Note | NoteFormDraft)[]; older?: (comparison: FileComparison) => boolean | undefined }) => <For each={props.rows} fallback={<p>{copy.unreadableNoteDraft}</p>}>{note => <div><p class="note-path">{note.comparison.newPath}<Show when={props.older?.(note.comparison)}>{copy.originalContext}</Show></p><p>{copy.noteLocation(note.comparison.newPath, note.side, Number(note.start), Number(note.end))}</p><p class="note-text">{note.text}</p></div>}</For>;
