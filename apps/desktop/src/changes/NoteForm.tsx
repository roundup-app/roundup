import { copy } from "../copy";
import { Tabs } from "../ui/Tabs";
import { createSignal } from "solid-js";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { Note, Notes } from "./notes";

/** Keyboard selection uses the same source and inclusive range as Pierre's gutter selection. */
export const NoteForm = (props: { id: string; comparison: FileComparison; notes: Notes; selection: { side: "old" | "new"; start: number; end: number }; editing?: Note | undefined; close: () => void }) => {
  const comparison = props.editing?.comparison ?? props.comparison;
  const [side, setSide] = createSignal(props.editing?.side ?? props.selection.side);
  const [start, setStart] = createSignal(props.editing?.start ?? props.selection.start);
  const [end, setEnd] = createSignal(props.editing?.end ?? props.selection.end);
  const [text, setText] = createSignal(props.editing?.text ?? "");

  const lines = () => {
    const content = comparison[side()];

    if (content.kind !== "text" || content.text === "") return [];
    const result = content.text.split("\n");

    if (result.at(-1) === "") result.pop();

    return result;
  };

  const valid = () => text().trim() !== "" && Number.isInteger(start()) && Number.isInteger(end()) && start() >= 1 && end() >= start() && end() <= lines().length && (props.editing !== undefined || props.notes.list(props.id).length < 200);

  return <form class="note-form" aria-label={copy.lineNote} onSubmit={event => {
    event.preventDefault();

    if (valid() && props.notes.save(props.id, { comparison, side: side(), start: start(), end: end(), source: lines().slice(start() - 1, end()).join("\n"), text: text() }, props.editing?.id)) props.close();
  }}>
    <Tabs.Root value={side()} onValueChange={({ value }) => setSide(value === "old" ? "old" : "new")}>
      <Tabs.List aria-label={copy.noteSide}><Tabs.Trigger value="old">{copy.oldSide}</Tabs.Trigger><Tabs.Trigger value="new">{copy.newSide}</Tabs.Trigger></Tabs.List>
      <Tabs.Content value="old">{copy.selectOldLines}</Tabs.Content><Tabs.Content value="new">{copy.selectNewLines}</Tabs.Content>
    </Tabs.Root>
    <label>{copy.startLine}<input type="number" min="1" value={start()} onInput={event => setStart(event.currentTarget.valueAsNumber)} /></label>
    <label>{copy.endLine}<input type="number" min="1" value={end()} onInput={event => setEnd(event.currentTarget.valueAsNumber)} /></label>
    <label class="note-field">{copy.note}<textarea value={text()} maxLength={20000} onInput={event => setText(event.currentTarget.value)} ref={element => queueMicrotask(() => element.focus())} /></label>
    <p role="status">{props.notes.list(props.id).length >= 200 ? copy.notesFull : copy.chooseLines}</p>
    <div class="diff-actions"><button type="button" data-button="quiet" onClick={props.close}>{copy.cancel}</button><button type="submit" data-button="quiet" disabled={!valid()}>{copy.save}</button></div>
  </form>;
};
