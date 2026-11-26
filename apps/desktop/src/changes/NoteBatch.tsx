import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import "../ui/Combobox.css";
import { EmptyState } from "../ink/EmptyState";
import { captureFocus } from "../keys/focus";
import { createItemFailures } from "../ink/itemFailures";
import { clipboardFailure } from "../app/clipboard";
import { CopyButton } from "../ui/CopyButton";
import { createCutTitle } from "../ui/cutTitle";
import { copy } from "./copy";
import { BusyButton } from "../ui/BusyButton";
import { createWritableMemo } from "@solid-primitives/memo";
import { createEffect, createMemo, createSignal, For, onSettled, Show, untrack } from "solid-js";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@ui-sdk/solid/command";
import { statusOf, where, words } from "./NoteView";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { NoteStatus } from "./NoteView";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { dismissable } from "../ink/recovery";
import { DialogFailure, InlineStatus, StatusNote } from "../ink/MountedLine";
import { createMessageToast } from "../ink/messageToast";
import { modalOutside } from "../keys/registry";
import { Dialog } from "../ui/Dialog";
import { useConnectedProject } from "../state/connectedProject";
import { filesOf, isItem, isLine, reply, titleOf } from "./notes";
import { NoteForm } from "./NoteForm";
import type { Form, ItemNote, LineNote, Note, NoteFormDraft, Notes } from "./notes";

/** The lines of a line note or an unfinished form, as the batch words them. */
const spanOf = (row: { side: "old" | "new"; start: number | string; end: number | string }) => {
  const start = Number(row.start);
  const end = Number(row.end);

  return copy.selectedLines(row.side, start === end ? `${start}` : `${start}–${end}`, start === end);
};

/** What a stored row names: an item's title and kind, or a file and its lines (U7691b). */
const target = (row: Note | Form, older?: (comparison: FileComparison) => string | null) => isItem(row)
  ? <><p class="note-path">{row.item.title}</p><p>{copy.itemMeta(row.item.kind, filesOf(row.item).length)}</p></>
  : <><p class="note-path">{row.comparison.newPath}{older?.(row.comparison)}</p><p>{spanOf(row)}</p></>;

const olderComparison = (current: FileComparison | undefined, original: FileComparison) => current && current.newPath === original.newPath && (current.oldPath !== original.oldPath || current.base !== original.base || current.old.revision !== original.old.revision || current.new.revision !== original.new.revision);

/** About as many notes as the batch shows without scrolling. */
const SLICE = 5;

const NotePath = (props: { path: string }) => {
  const cut = createCutTitle(() => props.path);

  return <p {...cut.attrs()} class="note-path" style={{ width: "fit-content", "max-width": "100%" }}>{props.path}</p>;
};

/** The keyboard-reachable batch remains available from the tree as well as the reader. */
export const NoteBatch = (props: { id: string; name: string; fallback?: () => void; notes: Notes; comparison?: FileComparison | undefined; readOf?: ((path: string) => FileComparison | undefined) | undefined; edit: (note: Note) => void; recover: () => void }) => {
  const state = () => props.notes.state(props.id);

  const [open, setOpen] = createSignal(false);

  const status = () => {
    const value = state();

    if (value.kind === "pending") return copy.submittingNotes;

    if (value.kind === "idle" && value.sent) return copy.notesSent(value.sent, props.name);

    if (props.notes.failure(props.id) !== null) return copy.notesCouldntSend(list().length, props.name);

    if (keptLine()) return copy.notesKept(props.notes.kept(props.id));

    return value.text;
  };

  // U7676c, U7676d: the Sent and kept-from-restart lines stay until the user starts another note or dismisses them.
  const sentLine = () => {
    const value = state();

    return value.kind === "idle" && value.sent !== undefined;
  };

  const keptLine = () => state().kind === "idle" && props.notes.kept(props.id) > 0;

  const noteWords = { sending: copy.sending, unknown: copy.sendUnknown, failed: copy.couldntSend, unsent: copy.notSent };

  const uncertain = () => state().kind === "unknown";
  const busy = () => state().kind === "pending" || uncertain();

  const older = (note: Note) => !isItem(note) && olderComparison(props.readOf ? props.readOf(note.comparison.newPath) : props.comparison, note.comparison);

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
    get action() { return <Show when={props.notes.problem()}><IconButton aria-label={copy.openNotesRecovery} onClick={props.recover}><Icon name="sticky-note" /></IconButton></Show>; },
  });

  return <Show when={list().length > 0 || status() || props.notes.removed(props.id)}><section class="note-batch note-bar" aria-label={copy.notesRegion} onKeyDown={event => { if (event.key === "Escape" && open()) { event.stopPropagation(); setOpen(false); } }}>
      <StatusNote text={noteLine.message() && !props.notes.failure(props.id) ? null : status()} />
      <Show when={sentLine() || (keptLine() && props.notes.failure(props.id) === null)}><IconButton aria-label={copy.dismissLine} onClick={() => { if (sentLine()) props.notes.dismissSent(props.id); else props.notes.dismissKept(props.id); props.fallback?.(); }}><Icon name="x" /></IconButton></Show>
      <Show when={props.notes.removed(props.id)}><p role="status"><span>{copy.noteRemoved}</span>{copy.dottedAfter("")}<BusyButton kind="icon" aria-label={copy.undo} busyLabel={copy.restoring} onClick={() => props.notes.undo(props.id)}><Icon name="reply" /></BusyButton></p></Show>
      <Show when={list().length}><button type="button" data-button="quiet" aria-expanded={open() ? "true" : "false"} onClick={() => setOpen(value => !value)}>{copy.noteCount(list().length)}</button></Show>
      <Show when={uncertain()}><BusyButton kind="icon" aria-label={copy.checkMessageHistory} busyLabel={copy.checking} onClick={() => props.notes.reconcile(props.id)}><Icon name="messages" /></BusyButton></Show>
      <Show when={list().length && open()}>
        <ul aria-label={copy.notes}><For each={list().slice(0, mounted())}>{(note, index) => <li>
          <NotePath path={titleOf(note)} />
          <p>{isItem(note) ? copy.itemMeta(note.item.kind, filesOf(note.item).length) : spanOf(note)}<InlineStatus text={older(note) ? copy.originalContext : null} />{copy.dottedAfter(noteWords[props.notes.noteState(props.id, note)])}</p>
          <p class="note-text">{note.text}</p>
          <Show when={props.notes.noteState(props.id, note) === "unsent" || props.notes.noteState(props.id, note) === "failed"}><div class="diff-actions">
            <IconButton aria-label={copy.editNote(index() + 1)} onClick={() => props.edit(note)}><Icon name="edit" /></IconButton>
            <IconButton data-note-action="remove" aria-label={copy.removeNote(index() + 1)} onClick={event => {
              const focused = event.currentTarget === document.activeElement;
              const buttons = [...event.currentTarget.closest("ul")!.querySelectorAll<HTMLButtonElement>(".diff-actions [data-note-action=remove]")];
              const at = buttons.indexOf(event.currentTarget);
              props.notes.remove(props.id, note.id);

              if (focused) {
                const next = buttons[at + 1] ?? buttons[at - 1];

                if (next?.isConnected) next.focus();
                else props.fallback?.();
              }
            }}><Icon name="trash" /></IconButton>
          </div></Show>
        </li>}</For></ul>
      </Show>
      <Show when={list().length > 0 && !uncertain()}><BusyButton kind="icon" aria-label={props.notes.failure(props.id) !== null ? copy.retry : copy.sendNotesTo(props.name)} busy={busy()} busyLabel={copy.sending} onClick={event => {
        const focus = captureFocus();
        const button = event.currentTarget;
        const focused = document.activeElement === button;

        return props.notes.send(props.id).then(() => {
          if (focused && (document.activeElement === button || document.activeElement === document.body) && props.notes.list(props.id).length === 0) focus(() => props.fallback?.());
        });
      }}><Icon name={props.notes.failure(props.id) !== null ? "rotate-cw" : "send"} /></BusyButton></Show>
    </section></Show>;
};


/** Project-local access stays available when the original Agent or Worktree is gone. */
export const NoteRecovery = (props: { compact?: boolean | undefined; notes: Notes; available: (id: string) => boolean; name: (id: string) => string; open: boolean; onOpenChange: (open: boolean) => void }) => {
  const { app } = useConnectedProject();
  const [element, setElement] = createSignal<HTMLElement>();
  const { rail } = useConnectedProject();
  const [comparisons, setComparisons] = createSignal<ReadonlyMap<string, FileComparison | "unreadable">>(new Map());

  createEffect(createMemo(() => props.open), open => {
    if (!open) return;
    let active = true;

    setComparisons(new Map());

    // The files compared are those of the notes kept, and the Agents still in the Rail, when the panel opens.
    for (const [id, value] of untrack(() => props.notes.entries().filter(([id]) => props.available(id) || rail.nodes.some(node => node.id === id)))) {
      const paths = new Set([...value.forms, ...value.notes, ...value.submissions.flatMap(submission => submission.notes), ...value.recovered.flatMap(record => [...record.data.forms, ...record.data.notes])].flatMap(note => isLine(note) ? [note.comparison.newPath] : []));

      // U7873a: a file is read through the group that lists it, so an Agent with no Worktree reads as one with its own.
      const groups = reply(() => app.rpc("agent.ownedChanges", { id }));

      for (const path of paths) void groups.then(async owned => {
        const found = owned.kind === "ok" ? owned.value.groups.find(group => group.files.some(file => file.path === path)) : undefined;
        const result = found ? await reply(() => app.rpc("agent.compareFile", { id, path, group: { repo: found.repo, branch: found.branch } })) : undefined;

        if (active) setComparisons(previous => new Map(previous).set(`${id}:${path}`, result?.kind === "ok" ? result.value : "unreadable"));
      });
    }

    return () => { active = false; };
  });

  const read = (id: string, path: string) => {
    const found = comparisons().get(`${id}:${path}`);

    return found === "unreadable" ? undefined : found;
  };

  const older = (id: string, comparison: FileComparison) => {
    const found = comparisons().get(`${id}:${comparison.newPath}`);

    return found === "unreadable" ? copy.cannotCompare : olderComparison(found, comparison) ? copy.originalContext : null;
  };

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

  // U7677e: a Sent note is kept on the diff, never recovered work.
  const unsent = (notes: readonly Note[]) => notes.filter(note => note.sent === undefined);

  const entries = () => props.notes.entries().filter(([, value]) => value.forms.length || unsent(value.notes).length || value.submissions.length || value.recovered.length);
  const retained = () => entries().length > 0 || props.notes.invalid().length > 0 || !!props.notes.problem();

  const problemLine = dismissable(() => props.notes.problem());

  createEffect(createMemo(() => props.open && element() && modalOutside(element())), outside => { if (outside) close(); });

  return <Dialog.Root instant modal={false} closeOnInteractOutside={false} open={props.open} onOpenChange={({ open }) => { if (open) props.onOpenChange(true); else close(); }}>
    <Show when={retained() && !props.open}><Dialog.Trigger render={attrs => <IconButton {...attrs} aria-label={copy.recoverNotes}><Icon name="sticky-note" /></IconButton>} /></Show>
    <Dialog.Content ref={setElement} class="worktree-panel note-recovery" aria-label={copy.recoverNotes}>
      <header class="diff-header"><Dialog.Title class="diff-identity">{copy.recoverNotes}</Dialog.Title><IconButton aria-label={copy.close} onClick={close}><Icon name="x" /></IconButton></header>
      <Show when={!retained()}><EmptyState art="clumsy" {...{ title: copy.noNoteDrafts }} line={copy.emptyNotesLine} /></Show>
      <DialogFailure message={problemLine.message()} dismiss={problemLine.dismiss} recover={{ run: props.notes.retry }} />
      <For each={failed()}>{([key, text]) => <DialogFailure message={text} dismiss={() => clear(key)} />}</For>

      <Show when={editing()} keyed>{value => <NoteForm id={value.id} comparison={read(value.id, value.form.comparison.newPath) ?? value.form.comparison} notes={props.notes} recovered={value.form} selection={{ side: value.form.side, start: Number(value.form.start), end: Number(value.form.end) }} close={() => setEditing(undefined)} />}</Show>
      <For each={entries()}>{([id, value]) => <section class="note-batch">
        <h3>{copy.noteDraftStatus(props.name(id), value.submissions[0]?.status ?? copy.noteDraft)}</h3>
        <StatusNote text={!props.available(id) ? copy.originalRecipientUnavailable : null} />
        <For each={value.forms}>{form => <div class="note-recovered-batch">
          {target(form, comparison => older(id, comparison))}<p class="note-text">{form.text}</p>
          <div class="diff-actions"><CopyButton data-button="icon" aria-label={copy.copy} app={app} text={JSON.stringify({ project: props.notes.project, recipient: id, form }, null, 2)} identity={form.revision} onSuccess={() => clear(form.revision)} onFailure={error => failures.fail(form.revision, clipboardFailure("copy", error))}><Icon name="copy" /></CopyButton><Show when={isLine(form) && props.available(id)}><IconButton data-note-action="resume" aria-label={copy.resumeNote} onClick={() => { if (isLine(form)) setEditing({ id, form }); }}><Icon name="play" /></IconButton></Show><IconButton aria-label={copy.discardDraft} onClick={() => { props.notes.discardForm(id, form.revision); setEditing(undefined); }}><Icon name="trash" /></IconButton></div>
        </div>}</For>
        <For each={unsent(value.notes)}>{note => <div class="note-recovered-batch">
          {target(note, comparison => older(id, comparison))}<p class="note-text">{note.text}</p>
          <div class="diff-actions"><CopyButton data-button="icon" aria-label={copy.copy} app={app} text={JSON.stringify({ project: props.notes.project, recipient: id, note }, null, 2)} identity={note.revision} onSuccess={() => clear(note.revision)} onFailure={error => failures.fail(note.revision, clipboardFailure("copy", error))}><Icon name="copy" /></CopyButton><IconButton aria-label={copy.discardDraft} onClick={() => props.notes.remove(id, note.id)}><Icon name="trash" /></IconButton></div>
        </div>}</For>
        <For each={value.recovered}>{recovered => <div class="note-recovered-batch"><RecordPreview older={comparison => older(id, comparison)} rows={[...recovered.data.forms, ...recovered.data.notes, ...recovered.data.submissions.flatMap(submission => submission.notes)]} /><div class="diff-actions"><CopyButton data-button="icon" aria-label={copy.copy} app={app} text={JSON.stringify({ project: props.notes.project, recipient: id, ...recovered }, null, 2)} identity={recovered.revision} onSuccess={() => clear(recovered.revision)} onFailure={error => failures.fail(recovered.revision, clipboardFailure("copy", error))}><Icon name="copy" /></CopyButton><IconButton aria-label={copy.discardDraft} onClick={() => props.notes.discardRecovered(id, recovered.revision)}><Icon name="trash" /></IconButton></div></div>}</For>
        <For each={value.submissions}>{submission => <div class="note-recovered-batch">
          <StatusNote text={`${copy.noteDraftStatus(props.name(id), submission.status)} ${submission.text}`} /><RecordPreview older={comparison => older(id, comparison)} rows={submission.notes} />
          <div class="diff-actions"><CopyButton data-button="icon" aria-label={copy.copy} app={app} text={submission.body} identity={submission.revision} onSuccess={() => clear(submission.revision)} onFailure={error => failures.fail(submission.revision, clipboardFailure("copy", error))}><Icon name="copy" /></CopyButton><Show when={submission.status === "unknown"}><BusyButton kind="icon" aria-label={copy.checkMessageHistory} busyLabel={copy.checking} onClick={() => props.notes.reconcile(id)}><Icon name="messages" /></BusyButton></Show><Show when={submission.status !== "pending"}><IconButton aria-label={copy.discardSubmission} onClick={() => props.notes.discardSubmission(id, submission.revision)}><Icon name="trash" /></IconButton></Show></div>
        </div>}</For>
      </section>}</For>
      <For each={props.notes.invalid()}>{draft => <div><RecordPreview rows={draft.preview} /><div class="diff-actions"><CopyButton data-button="icon" aria-label={copy.copy} app={app} text={JSON.stringify(draft)} identity={draft.revision} onSuccess={() => clear(draft.revision)} onFailure={error => failures.fail(draft.revision, clipboardFailure("copy", error))}><Icon name="copy" /></CopyButton><IconButton aria-label={copy.discardDraft} onClick={() => props.notes.discardInvalid(draft.revision)}><Icon name="trash" /></IconButton></div></div>}</For>
    </Dialog.Content>
  </Dialog.Root>;
};

/** Recovery uses the same path, range and text presentation as live notes. */
const RecordPreview = (props: { rows: readonly (Note | Form)[]; older?: (comparison: FileComparison) => string | null }) => <For each={props.rows} fallback={<p>{copy.unreadableNoteDraft}</p>}>{note => <div class="note-recovered-batch">{target(note, props.older)}<p class="note-text">{note.text}</p></div>}</For>;


/** U7690c: a note in the jump list: its state, and whether its file is still in the change. */
export type JumpRow = { note: Note; status: NoteStatus; listed: boolean };

/** A note's file in file order: an item note's first file (U7691d). */
const pathOf = (note: Note) => isItem(note) ? filesOf(note.item)[0] ?? "" : note.comparison.newPath;

const rank = (note: Note) => isItem(note) ? { line: 0, start: 0, side: 0 } : { line: 1, start: note.start, side: Number(note.side === "new") };

/** U7690c, U7691d: the notes of one Agent in file order: the files in path order, an item note before the line notes of its first file, then line, the old side before the new. */
export const jumpOrder = (notes: readonly Note[]) => [...notes].sort((left, right) => (pathOf(left) < pathOf(right) ? -1 : pathOf(left) > pathOf(right) ? 1 : 0) || rank(left).line - rank(right).line || rank(left).start - rank(right).start || rank(left).side - rank(right).side || left.id - right.id);

/** U7690c: every note of the Agent in one list; ui-sdk's Command owns the highlight, Up, Down and Enter, and the query only narrows it. */
export const NoteJump = (props: { rows: readonly JumpRow[]; highlighted: number; choose: (note: Note) => void; close: () => void }) => {
  const [query, setQuery] = createSignal("");
  const [value, setValue] = createSignal<string | null>(null);
  const text = (row: JumpRow) => `${titleOf(row.note)} ${where(row.note)} ${row.note.label ?? ""} ${row.note.text}`.toLowerCase();
  const shown = () => props.rows.filter(row => text(row).includes(query().trim().toLowerCase()));
  const key = (row: JumpRow) => String(row.note.id);
  let input: HTMLInputElement | undefined;

  // ui-sdk 0.1.0-beta.5 recurses without end when a Command unmounts in the turn it mounted while its value names a row, so the value names one only once settled.
  onSettled(() => {
    const row = props.rows[props.highlighted];

    setValue(row ? key(row) : null);
    input?.focus({ preventScroll: true });
  });

  return <section class="note-jump" aria-label={copy.jumpToNote}>
    <Command class="app-combobox" value={value()} loop={false} filter={false} query={query()} onValueChange={(next, details) => { if (details.reason === "item-hover") details.cancel(); else setValue(next); }} onQueryChange={(next, details) => { if (details.reason === "escape-key") details.cancel(); else setQuery(next); }} onAction={chosen => {
      const row = props.rows.find(each => key(each) === chosen);

      if (row?.listed) props.choose(row.note);
    }}>
      <CommandInput class="app-combobox-input" aria-label={copy.jumpToNote} placeholder={copy.jumpPlaceholder} spellcheck="false" autocorrect="off" autocapitalize="off" ref={element => { input = element; }} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); props.close(); } }} />
      <CommandEmpty class="app-combobox-empty">{copy.noNotesFound}</CommandEmpty>
      <CommandList class="app-combobox-list" aria-label={copy.notes}>
        <For each={shown()}>{row => <CommandItem class="app-combobox-item" value={key(row)} label={`${titleOf(row.note)} ${where(row.note)}`}>
          <span class="note-jump-path">{titleOf(row.note)}</span>
          <span class="note-jump-meta">{where(row.note)}{row.note.label === undefined ? "" : copy.dottedAfter(copy.labels[row.note.label])}{copy.dottedAfter(words(row.status, row.note))}{row.listed ? "" : copy.dottedAfter(copy.noLongerChanged)}</span>
          <span class="note-jump-text">{row.note.text.split("\n")[0]}</span>
        </CommandItem>}</For>
      </CommandList>
    </Command>
  </section>;
};

/** U7690c: G opens the list; a choice opens its file (`open`) and aims the reader at its line until `arrived`. */
export const createJump = (deps: { id: string; notes: Notes; files: () => readonly ChangedFile[]; keys: () => { at: () => { path: string; side: "old" | "new"; line: number }; outdated: (note: LineNote) => boolean } | undefined; itemOutdated: (note: ItemNote) => boolean; section: () => HTMLElement | undefined; open: (path: string) => void }) => {
  const [jumping, setJumping] = createSignal(false);
  const [aim, setAim] = createSignal<{ path: string; side: "old" | "new"; line: number }>();
  let origin: Element | null = null;

  const status = (note: Note): NoteStatus => statusOf(deps.notes, deps.id, note, () => isItem(note) ? deps.itemOutdated(note) : deps.keys()?.outdated(note) ?? false);

  const listed = (path: string) => deps.files().some(file => file.path === path);

  const filesOfNote = (note: Note) => isItem(note) ? filesOf(note.item) : [note.comparison.newPath];

  const rows = () => jumpOrder(deps.notes.all(deps.id)).map(note => ({ note, status: status(note), listed: filesOfNote(note).some(listed) }));

  // The first note after the focused line in file order, else the first.
  const start = (list: readonly JumpRow[]) => {
    const at = deps.keys()?.at();
    const after = at === undefined ? -1 : list.findIndex(({ note }) => pathOf(note) > at.path || (pathOf(note) === at.path && !isItem(note) && (note.start > at.line || (note.start === at.line && note.side === "new" && at.side === "old"))));

    return Math.max(after, 0);
  };

  // Esc returns focus to where it was, the view when that element cannot take it; the view first, so the list's field never holds it as it leaves.
  const close = () => {
    deps.section()?.focus();

    if (origin instanceof HTMLElement && origin.isConnected && deps.section()?.contains(origin)) origin.focus();
    setJumping(false);
  };

  // An item note opens its first file the change still lists; a line note aims the reader at its line.
  const choose = (note: Note) => {
    setJumping(false);

    if (isItem(note)) {
      const first = filesOf(note.item).find(listed);

      if (first !== undefined) deps.open(first);

      return;
    }

    deps.open(note.comparison.newPath);
    setAim({ path: note.comparison.newPath, side: note.side, line: note.start });
  };

  return {
    aim, arrived: () => setAim(undefined), itemOutdated: deps.itemOutdated,
    open: () => {
      if (deps.notes.all(deps.id).length === 0) return;
      origin = document.activeElement;
      setJumping(true);
    },
    list: () => <Show when={jumping()}><NoteJump rows={untrack(rows)} highlighted={untrack(() => start(rows()))} choose={choose} close={close} /></Show>,
  };
};
