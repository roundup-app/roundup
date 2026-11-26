import { queueFocus } from "../keys/focus";
import { StatusNote } from "../ink/MountedLine";
import { copy } from "./copy";
import { BusyButton } from "../ui/BusyButton";
import { Tabs } from "../ui/Tabs";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { extrasOf, changed, LabelRow, optionalOf, ReplacementField, sameExtras, sourceOf, suggestionOf } from "./NoteExtras";
import type { Extras } from "./NoteExtras";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { LineNote, Notes, NoteFormDraft } from "./notes";

type Fields = Pick<NoteFormDraft, "side" | "start" | "end" | "text"> & Extras;

/** The note the field was opened on, with nothing changed. */
const unedited = (note: LineNote, fields: Fields) => fields.text === note.text && fields.side === note.side && fields.start === String(note.start) && fields.end === String(note.end) && sameExtras(fields, extrasOf(note));

/** Keyboard selection uses the same source and inclusive range as Pierre's gutter selection. */
export const NoteForm = (props: { id: string; comparison: FileComparison; notes: Notes; selection: { side: "old" | "new"; start: number; end: number }; editing?: LineNote | undefined; recovered?: NoteFormDraft | undefined; close: () => void; /** U7677d: the field holds or loses focus, for the gutter bar. */ focus?: ((active: boolean) => void) | undefined }) => {
  const restored = untrack(() => props.recovered ?? props.notes.form(props.id, props.comparison, props.editing?.id));
  const comparison = restored?.comparison ?? props.editing?.comparison ?? props.comparison;
  const revision = restored?.revision ?? crypto.randomUUID();
  const replacing = restored?.replacing ?? props.editing?.id;

  const { editing, selection } = untrack(() => ({ editing: props.editing, selection: props.selection }));

  const initial: Fields = {
    side: restored?.side ?? editing?.side ?? selection.side,
    start: restored?.start ?? String(editing?.start ?? selection.start),
    end: restored?.end ?? String(editing?.end ?? selection.end),
    text: restored?.text ?? editing?.text ?? "",
    ...extrasOf(restored, editing),
  };

  const [fields, setFields] = createSignal(initial);
  // rc.21 reads lag writes until flush; the retained form must carry what the last edit wrote, so `written` keeps it.
  let written = initial;
  const side = () => fields().side;
  const start = () => fields().start;
  const end = () => fields().end;
  const text = () => fields().text;
  const replacement = () => fields().replacement;
  let field: HTMLTextAreaElement | undefined;
  let disposed = false;
  const [active, setActive] = createSignal(false);
  let form: HTMLFormElement | undefined;

  // The attribute is set outside the template so a focus change never re-applies the textarea's bound value over the user's input.
  createEffect(active, on => { form?.toggleAttribute("data-focused", on); });

  // U7677d: the field grows with its text to 12 lines, then scrolls.
  const rows = () => Math.min(12, Math.max(2, text().split("\n").length));

  // U7676c: a stored note ends its field's draft; from the Save click to the close no late select event writes the draft back.
  let closing = false;

  onCleanup(() => { disposed = true; props.focus?.(false); });

  const persist = () => {
    if (closing) return;

    props.notes.editForm(props.id, {
      revision, comparison, replacing: replacing ?? null, side: written.side, start: written.start, end: written.end, text: written.text, ...optionalOf(written),
      selection: field ? { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection } : restored?.selection ?? props.editing?.selection ?? null,
    });
  };

  const edit = (change: Partial<Fields>) => {
    written = changed(comparison, written, change);
    setFields(written);
    persist();
  };

  const lines = () => {
    const content = comparison[side()];

    if (content.kind !== "text" || content.text === "") return [];
    const result = content.text.split("\n");

    if (result.at(-1) === "") result.pop();

    return result;
  };

  const valid = () => text().trim() !== "" && start() !== "" && end() !== "" && Number.isInteger(Number(start())) && Number.isInteger(Number(end())) && Number(start()) >= 1 && Number(end()) >= Number(start()) && Number(end()) <= lines().length && (replacing !== undefined || props.notes.list(props.id).length < 200);

  const save = async () => {
    const submitted = text();

    if (!valid()) return;
    closing = true;
    const stored = await props.notes.save(props.id, { comparison, side: side(), start: Number(start()), end: Number(end()), source: sourceOf(comparison, fields()), text: text(), ...optionalOf({ label: fields().label, replacement: suggestionOf(comparison, fields()) }), selection: field ? { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection } : null }, replacing, revision);

    closing = stored && !disposed && text() === submitted;

    if (closing) props.close();
  };

  // U170: the Save click holds the save, so the button is busy while it runs; Enter clicks it too.
  // U7676b: Esc keeps typed text as unfinished work; an empty or unchanged field leaves nothing behind.
  const leave = () => {
    const untouched = text().trim() === "" || (editing !== undefined && unedited(editing, fields()));

    if (untouched) void props.notes.discardForm(props.id, revision);
    props.close();
  };

  // SAFETY: relatedTarget is null or the Node focus moved to.
  return <form class="note-form" data-surface="diff" ref={form} aria-label={copy.lineNote} onFocusIn={() => { setActive(true); props.focus?.(true); }} onFocusOut={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setActive(false); props.focus?.(false); } }} onKeyDown={event => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save(); }
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); leave(); }
  }} onSubmit={event => { event.preventDefault(); void save(); }}>
    <Tabs.Root value={side()} onValueChange={({ value }) => edit({ side: value === "old" ? "old" : "new" })}>
      <Tabs.List aria-label={copy.noteSide}><Tabs.Trigger value="old">{copy.oldSide}</Tabs.Trigger><Tabs.Trigger value="new">{copy.newSide}</Tabs.Trigger></Tabs.List>
      <Tabs.Content value="old">{copy.selectOldLines}</Tabs.Content><Tabs.Content value="new">{copy.selectNewLines}</Tabs.Content>
    </Tabs.Root>
    <label>{copy.startLine}<input type="number" min="1" value={start()} onInput={event => edit({ start: event.currentTarget.value })} /></label>
    <label>{copy.endLine}<input type="number" min="1" value={end()} onInput={event => edit({ end: event.currentTarget.value })} /></label>
    <label class="note-field">{copy.note}<textarea class="note-input field-inline" rows={rows()} spellcheck="false" autocorrect="off" autocapitalize="off" value={text()} maxlength={20000} onInput={event => edit({ text: event.currentTarget.value })} onSelect={() => { if (written.text !== "" || restored || replacing !== undefined) persist(); }} ref={element => {
      field = element;
      queueFocus(() => {
        if (!element.isConnected) return;
        element.focus();

        const selection = restored?.selection ?? props.editing?.selection;

        if (selection) element.setSelectionRange(selection.start, selection.end, selection.direction);
      });
    }} /></label>
    <LabelRow fields={fields()} comparison={comparison} edit={edit} />
    <ReplacementField value={replacement()} edit={text => edit({ replacement: text })} />
    <StatusNote text={(comparison.oldPath !== props.comparison.oldPath || comparison.newPath !== props.comparison.newPath || comparison.base !== props.comparison.base || comparison.old.revision !== props.comparison.old.revision || comparison.new.revision !== props.comparison.new.revision ? copy.originalContextStatus : null) || (props.notes.list(props.id).length >= 200 ? copy.notesFull : copy.chooseLines) || null} />
    <div class="diff-actions"><p class="note-hint">{copy.saveHint}</p><BusyButton kind="quiet" type="submit" disabled={!valid()} busyLabel={copy.saving} onClick={event => {
      event.preventDefault();

      return save();
    }}>{copy.save}</BusyButton></div>
  </form>;
};
