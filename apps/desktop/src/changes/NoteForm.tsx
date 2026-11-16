import { queueFocus } from "../keys/focus";
import { ReservedLine } from "../ink/ReservedLine";
import { copy } from "./copy";
import { BusyButton } from "../ui/BusyButton";
import { Tabs } from "../ui/Tabs";
import { createSignal, onCleanup, untrack } from "solid-js";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { Note, Notes, NoteFormDraft } from "./notes";

type Fields = Pick<NoteFormDraft, "side" | "start" | "end" | "text">;

/** Keyboard selection uses the same source and inclusive range as Pierre's gutter selection. */
export const NoteForm = (props: { id: string; comparison: FileComparison; notes: Notes; selection: { side: "old" | "new"; start: number; end: number }; editing?: Note | undefined; recovered?: NoteFormDraft | undefined; close: () => void }) => {
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
  };

  const [fields, setFields] = createSignal(initial);
  // rc.21 reads lag writes until flush; the retained form must carry what the last edit wrote, so `written` keeps it.
  let written = initial;
  const side = () => fields().side;
  const start = () => fields().start;
  const end = () => fields().end;
  const text = () => fields().text;
  let field: HTMLTextAreaElement | undefined;
  let disposed = false;

  onCleanup(() => { disposed = true; });

  const persist = () => props.notes.editForm(props.id, {
    revision, comparison, replacing: replacing ?? null, ...written,
    selection: field ? { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection } : restored?.selection ?? props.editing?.selection ?? null,
  });

  const edit = (change: Partial<Fields>) => {
    written = { ...written, ...change };
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

    if (valid() && await props.notes.save(props.id, { comparison, side: side(), start: Number(start()), end: Number(end()), source: lines().slice(Number(start()) - 1, Number(end())).join("\n"), text: text(), selection: field ? { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection } : null }, replacing, revision) && !disposed && text() === submitted) props.close();
  };

  // U170: the Save click holds the save, so the button is busy while it runs; Enter clicks it too.
  return <form class="note-form" aria-label={copy.lineNote} onSubmit={event => { event.preventDefault(); void save(); }}>
    <Tabs.Root value={side()} onValueChange={({ value }) => edit({ side: value === "old" ? "old" : "new" })}>
      <Tabs.List aria-label={copy.noteSide}><Tabs.Trigger value="old">{copy.oldSide}</Tabs.Trigger><Tabs.Trigger value="new">{copy.newSide}</Tabs.Trigger></Tabs.List>
      <Tabs.Content value="old">{copy.selectOldLines}</Tabs.Content><Tabs.Content value="new">{copy.selectNewLines}</Tabs.Content>
    </Tabs.Root>
    <label>{copy.startLine}<input type="number" min="1" value={start()} onInput={event => edit({ start: event.currentTarget.value })} /></label>
    <label>{copy.endLine}<input type="number" min="1" value={end()} onInput={event => edit({ end: event.currentTarget.value })} /></label>
    <label class="note-field">{copy.note}<textarea class="field-frame" spellcheck="false" autocorrect="off" autocapitalize="off" value={text()} maxlength={20000} onInput={event => edit({ text: event.currentTarget.value })} onSelect={() => { if (written.text !== "" || restored || replacing !== undefined) persist(); }} ref={element => {
      field = element;
      queueFocus(() => {
        if (!element.isConnected) return;
        element.focus();

        const selection = restored?.selection ?? props.editing?.selection;

        if (selection) element.setSelectionRange(selection.start, selection.end, selection.direction);
      });
    }} /></label>
    <ReservedLine status={(comparison.oldPath !== props.comparison.oldPath || comparison.newPath !== props.comparison.newPath || comparison.base !== props.comparison.base || comparison.old.revision !== props.comparison.old.revision || comparison.new.revision !== props.comparison.new.revision ? copy.originalContextStatus : null) || (props.notes.list(props.id).length >= 200 ? copy.notesFull : copy.chooseLines) || null} />
    <div class="diff-actions"><button type="button" data-button="quiet" onClick={() => props.close()}>{copy.close}</button><BusyButton kind="quiet" type="submit" disabled={!valid()} busyLabel={copy.saving} onClick={event => {
      event.preventDefault();

      return save();
    }}>{copy.save}</BusyButton></div>
  </form>;
};
