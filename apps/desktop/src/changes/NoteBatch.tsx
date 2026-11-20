import { EmptyState } from "../ink/EmptyState";
import { captureFocus } from "../keys/focus";
import { createItemFailures } from "../ink/itemFailures";
import { clipboardFailure } from "../app/clipboard";
import { CopyButton } from "../ui/CopyButton";
import { createCutTitle } from "../ui/cutTitle";
import { copy } from "./copy";
import { BusyButton } from "../ui/BusyButton";
import { createWritableMemo } from "@solid-primitives/memo";
import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { dismissable } from "../ink/recovery";
import { DialogFailure, InlineStatus, StatusNote } from "../ink/MountedLine";
import { createMessageToast } from "../ink/messageToast";
import { modalOutside } from "../keys/registry";
import { Dialog } from "../ui/Dialog";
import { useConnectedProject } from "../state/connectedProject";
import { reply } from "./notes";
import { NoteForm } from "./NoteForm";
import type { NoteFormDraft } from "./notes";
import type { Note, Notes } from "./notes";

const olderComparison = (current: FileComparison | undefined, original: FileComparison) => current && current.newPath === original.newPath && (current.oldPath !== original.oldPath || current.base !== original.base || current.old.revision !== original.old.revision || current.new.revision !== original.new.revision);

/** About as many notes as the batch shows without scrolling. */
const SLICE = 5;

const NotePath = (props: { path: string }) => {
  const cut = createCutTitle(() => props.path);

  return <p {...cut.attrs()} class="note-path" style={{ width: "fit-content", "max-width": "100%" }}>{props.path}</p>;
};

/** The keyboard-reachable batch remains available from the tree as well as the reader. */
export const NoteBatch = (props: { id: string; name: string; fallback?: () => void; notes: Notes; comparison?: FileComparison | undefined; edit: (note: Note) => void; recover: () => void }) => {
  const state = () => props.notes.state(props.id);

  const [open, setOpen] = createSignal(false);

  const status = () => {
    const value = state();

    if (value.kind === "pending") return copy.submittingNotes;

    if (value.kind === "idle" && value.sent) return copy.notesSent(value.sent, props.name);

    if (props.notes.failure(props.id) !== null) return copy.notesCouldntSend(list().length, props.name);

    if (value.kind === "idle" && props.notes.kept(props.id)) return copy.notesKept(props.notes.kept(props.id));

    return value.text;
  };

  const noteWords = { sending: copy.sending, unknown: copy.sendUnknown, failed: copy.couldntSend, unsent: copy.notSent };

  const uncertain = () => state().kind === "unknown";
  const busy = () => state().kind === "pending" || uncertain();

  const older = (note: Note) => olderComparison(props.comparison, note.comparison);

  // U7610b: a batch already long when the view opens mounts a slice of notes per task, so the view never waits on every note; a batch that starts short shows each note at once.
  const list = () => props.notes.list(props.id);
  const [mounted, setMounted] = createSignal(untrack(list).length > SLICE ? SLICE : Infinity);

  createEffect(() => mounted() < list().length, more => {
    if (!more) return undefined;
    const timer = setTimeout(() => setMounted(count => count + SLICE < untrack(list).length ? count + SLICE : Infinity));

    return () => clearTimeout(timer);
  });

  const noteLine = dismissable(() => props.notes.problem() ?? props.notes.failure(props.id));

  createMessageToast({
    get message() { return noteLine.message(); },
    dismiss: () => props.notes.failure(props.id) ? props.notes.dismiss(props.id) : noteLine.dismiss(),
    get action() { return <Show when={props.notes.problem()}><button type="button" data-button="quiet" onClick={props.recover}>{copy.openNotesRecovery}</button></Show>; },
  });

  return <Show when={list().length > 0 || status() || props.notes.removed(props.id)}><section class="note-batch" aria-label={copy.notesRegion} onKeyDown={event => { if (event.key === "Escape" && open()) { event.stopPropagation(); setOpen(false); } }}>
      <StatusNote text={noteLine.message() && !props.notes.failure(props.id) ? null : status()} />
      <Show when={props.notes.removed(props.id)}><p role="status"><span>{copy.noteRemoved}</span> · <button type="button" data-button="quiet" onClick={() => { void props.notes.undo(props.id); }}>{copy.undo}</button></p></Show>
      <Show when={list().length}><button type="button" data-button="quiet" aria-expanded={open() ? "true" : "false"} onClick={() => setOpen(value => !value)}>{copy.noteCount(list().length)}</button></Show>
      <Show when={uncertain()}><BusyButton kind="quiet" busyLabel={copy.checking} onClick={() => props.notes.reconcile(props.id)}>{copy.checkMessageHistory}</BusyButton></Show>
      <Show when={list().length && open()}>
        <ul aria-label={copy.notes}><For each={list().slice(0, mounted())}>{(note, index) => <li>
          <NotePath path={note.comparison.newPath} />
          <p>{copy.selectedLines(note.side, note.start === note.end ? `${note.start}` : `${note.start}–${note.end}`, note.start === note.end)}<InlineStatus text={older(note) ? copy.originalContext : null} /> · {noteWords[props.notes.noteState(props.id, note)]}</p>
          <p class="note-text">{note.text}</p>
          <Show when={props.notes.noteState(props.id, note) === "unsent" || props.notes.noteState(props.id, note) === "failed"}><div class="diff-actions">
            <button type="button" data-button="quiet" aria-label={copy.editNote(index() + 1)} onClick={() => props.edit(note)}>{copy.editNoteAction}</button>
            <button type="button" data-button="quiet" aria-label={copy.removeNote(index() + 1)} onClick={event => {
              const focused = event.currentTarget === document.activeElement;
              const buttons = [...event.currentTarget.closest("ul")!.querySelectorAll<HTMLButtonElement>(".diff-actions button:last-child")];
              const at = buttons.indexOf(event.currentTarget);
              props.notes.remove(props.id, note.id);

              if (focused) {
                const next = buttons[at + 1] ?? buttons[at - 1];

                if (next?.isConnected) next.focus();
                else props.fallback?.();
              }
            }}>{copy.remove}</button>
          </div></Show>
        </li>}</For></ul>
      </Show>
      <Show when={list().length > 0 && !uncertain()}><BusyButton kind="quiet" busy={busy()} busyLabel={copy.sending} onClick={event => {
        const focus = captureFocus();
        const button = event.currentTarget;
        const focused = document.activeElement === button;

        return props.notes.send(props.id).then(() => {
          if (focused && (document.activeElement === button || document.activeElement === document.body) && props.notes.list(props.id).length === 0) focus(() => props.fallback?.());
        });
      }}>{props.notes.failure(props.id) !== null ? copy.retry : copy.sendNotesTo(props.name)}</BusyButton></Show>
    </section></Show>;
};


/** Project-local access stays available when the original Agent or Worktree is gone. */
export const NoteRecovery = (props: { compact?: boolean | undefined; notes: Notes; available: (id: string) => boolean; name: (id: string) => string; open: boolean; onOpenChange: (open: boolean) => void }) => {
  const { app } = useConnectedProject();
  const [element, setElement] = createSignal<HTMLElement>();
  const [comparisons, setComparisons] = createSignal<ReadonlyMap<string, FileComparison>>(new Map());

  createEffect(createMemo(() => props.open), open => {
    if (!open) return;
    let active = true;

    setComparisons(new Map());

    // The files compared are those of the notes kept, and the Agents still available, when the panel opens.
    for (const [id, value] of untrack(() => props.notes.entries().filter(([id]) => props.available(id)))) {
      const paths = new Set([...value.forms, ...value.notes, ...value.submissions.flatMap(submission => submission.notes), ...value.recovered.flatMap(record => [...record.data.forms, ...record.data.notes])].map(note => note.comparison.newPath));

      for (const path of paths) void reply(() => app.rpc("agent.compareFile", { id, path })).then(result => {
        if (active && result.kind === "ok") setComparisons(previous => new Map(previous).set(`${id}:${path}`, result.value));
      });
    }

    return () => { active = false; };
  });

  const older = (id: string, comparison: FileComparison) => olderComparison(comparisons().get(`${id}:${comparison.newPath}`), comparison);

  const [editing, setEditing] = createWritableMemo<{ id: string; form: NoteFormDraft } | undefined>(previous => props.open ? previous : undefined);

  // P3557c: a copy failure leaves with its record; a Daemon-side problem keeps every one.
  const revisions = createMemo(() => [...props.notes.entries().flatMap(([, value]) => [
    ...value.forms.map(form => form.revision), ...value.notes.map(note => note.revision),
    ...value.recovered.map(record => record.revision), ...value.submissions.map(submission => submission.revision),
  ]), ...props.notes.invalid().map(record => record.revision)]);

  const failures = createItemFailures<string>(() => props.notes.problem() ? "unknown" : revisions());

  const failed = () => revisions().flatMap(key => {
    const text = failures.failure(key);

    return text === undefined ? [] : [[key, text] as const];
  });

  const clear = failures.clear;
  const close = () => { props.onOpenChange(false); setEditing(undefined); };

  const entries = () => props.notes.entries().filter(([, value]) => value.forms.length || value.notes.length || value.submissions.length || value.recovered.length);
  const retained = () => entries().length > 0 || props.notes.invalid().length > 0 || !!props.notes.problem();

  const problemLine = dismissable(() => props.notes.problem());

  createEffect(createMemo(() => props.open && element() && modalOutside(element())), outside => { if (outside) close(); });

  return <Dialog.Root instant modal={false} closeOnInteractOutside={false} open={props.open} onOpenChange={({ open }) => { if (open) props.onOpenChange(true); else close(); }}>
    <Show when={retained() && !props.open}><Dialog.Trigger>{copy.recoverNotes}</Dialog.Trigger></Show>
    <Dialog.Content ref={setElement} class="worktree-panel note-recovery" aria-label={copy.recoverNotes}>
      <header class="diff-header"><Dialog.Title class="diff-identity">{copy.recoverNotes}</Dialog.Title><button type="button" onClick={close}>{copy.close}</button></header>
      <Show when={!retained()}><EmptyState art="clumsy" {...{ title: copy.noNoteDrafts }} line={copy.emptyNotesLine} /></Show>
      <DialogFailure message={problemLine.message()} dismiss={problemLine.dismiss} recover={{ run: props.notes.retry }} />
      <For each={failed()}>{([key, text]) => <DialogFailure message={text} dismiss={() => clear(key)} />}</For>

      <Show when={editing()} keyed>{value => <NoteForm id={value.id} comparison={comparisons().get(`${value.id}:${value.form.comparison.newPath}`) ?? value.form.comparison} notes={props.notes} recovered={value.form} selection={{ side: value.form.side, start: Number(value.form.start), end: Number(value.form.end) }} close={() => setEditing(undefined)} />}</Show>
      <For each={entries()}>{([id, value]) => <section class="note-batch">
        <h3>{copy.noteDraftStatus(props.name(id), value.submissions[0]?.status ?? copy.noteDraft)}</h3>
        <StatusNote text={!props.available(id) ? copy.originalRecipientUnavailable : null} />
        <For each={value.forms}>{form => <div class="note-recovered-batch">
          <p class="note-path">{form.comparison.newPath}<Show when={older(id, form.comparison)}>{copy.originalContext}</Show></p><p>{copy.selectedLines(form.side, Number(form.start) === Number(form.end) ? `${Number(form.start)}` : `${Number(form.start)}–${Number(form.end)}`, Number(form.start) === Number(form.end))}</p><p class="note-text">{form.text}</p>
          <div class="diff-actions"><CopyButton data-button={null} app={app} text={JSON.stringify({ project: props.notes.project, recipient: id, form }, null, 2)} identity={form.revision} onSuccess={() => clear(form.revision)} onFailure={error => failures.fail(form.revision, clipboardFailure("copy", error))}>{copy.copy}</CopyButton><Show when={props.available(id)}><button type="button" data-note-action="resume" onClick={() => setEditing({ id, form })}>{copy.resumeNote}</button></Show><button type="button" onClick={() => { props.notes.discardForm(id, form.revision); setEditing(undefined); }}>{copy.discardDraft}</button></div>
        </div>}</For>
        <For each={value.notes}>{note => <div class="note-recovered-batch">
          <p class="note-path">{note.comparison.newPath}<Show when={older(id, note.comparison)}>{copy.originalContext}</Show></p><p>{copy.selectedLines(note.side, note.start === note.end ? `${note.start}` : `${note.start}–${note.end}`, note.start === note.end)}</p><p class="note-text">{note.text}</p>
          <div class="diff-actions"><CopyButton data-button={null} app={app} text={JSON.stringify({ project: props.notes.project, recipient: id, note }, null, 2)} identity={note.revision} onSuccess={() => clear(note.revision)} onFailure={error => failures.fail(note.revision, clipboardFailure("copy", error))}>{copy.copy}</CopyButton><button type="button" onClick={() => props.notes.remove(id, note.id)}>{copy.discardDraft}</button></div>
        </div>}</For>
        <For each={value.recovered}>{recovered => <div class="note-recovered-batch"><RecordPreview older={comparison => older(id, comparison)} rows={[...recovered.data.forms, ...recovered.data.notes, ...recovered.data.submissions.flatMap(submission => submission.notes)]} /><div class="diff-actions"><CopyButton data-button={null} app={app} text={JSON.stringify({ project: props.notes.project, recipient: id, ...recovered }, null, 2)} identity={recovered.revision} onSuccess={() => clear(recovered.revision)} onFailure={error => failures.fail(recovered.revision, clipboardFailure("copy", error))}>{copy.copy}</CopyButton><button type="button" onClick={() => props.notes.discardRecovered(id, recovered.revision)}>{copy.discardDraft}</button></div></div>}</For>
        <For each={value.submissions}>{submission => <div class="note-recovered-batch">
          <StatusNote text={`${copy.noteDraftStatus(props.name(id), submission.status)} ${submission.text}`} /><RecordPreview older={comparison => older(id, comparison)} rows={submission.notes} />
          <div class="diff-actions"><CopyButton data-button={null} app={app} text={submission.body} identity={submission.revision} onSuccess={() => clear(submission.revision)} onFailure={error => failures.fail(submission.revision, clipboardFailure("copy", error))}>{copy.copy}</CopyButton><Show when={submission.status === "unknown"}><BusyButton kind={null} busyLabel={copy.checking} onClick={() => props.notes.reconcile(id)}>{copy.checkMessageHistory}</BusyButton></Show><Show when={submission.status !== "pending"}><button type="button" onClick={() => props.notes.discardSubmission(id, submission.revision)}>{copy.discardSubmission}</button></Show></div>
        </div>}</For>
      </section>}</For>
      <For each={props.notes.invalid()}>{draft => <div><RecordPreview rows={draft.preview} /><div class="diff-actions"><CopyButton data-button={null} app={app} text={JSON.stringify(draft)} identity={draft.revision} onSuccess={() => clear(draft.revision)} onFailure={error => failures.fail(draft.revision, clipboardFailure("copy", error))}>{copy.copy}</CopyButton><button type="button" onClick={() => props.notes.discardInvalid(draft.revision)}>{copy.discardDraft}</button></div></div>}</For>
    </Dialog.Content>
  </Dialog.Root>;
};

/** Recovery uses the same path, range and text presentation as live notes. */
const RecordPreview = (props: { rows: readonly (Note | NoteFormDraft)[]; older?: (comparison: FileComparison) => boolean | undefined }) => <For each={props.rows} fallback={<p>{copy.unreadableNoteDraft}</p>}>{note => <div class="note-recovered-batch"><p class="note-path">{note.comparison.newPath}<Show when={props.older?.(note.comparison)}>{copy.originalContext}</Show></p><p>{copy.selectedLines(note.side, Number(note.start) === Number(note.end) ? `${Number(note.start)}` : `${Number(note.start)}–${Number(note.end)}`, Number(note.start) === Number(note.end))}</p><p class="note-text">{note.text}</p></div>}</For>;
