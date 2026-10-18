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

  return <form class="note-form" aria-label="Line note" onSubmit={event => {
    event.preventDefault();

    if (valid() && props.notes.save(props.id, { comparison, side: side(), start: start(), end: end(), source: lines().slice(start() - 1, end()).join("\n"), text: text() }, props.editing?.id)) props.close();
  }}>
    <Tabs.Root value={side()} onValueChange={({ value }) => setSide(value === "old" ? "old" : "new")}>
      <Tabs.List aria-label="Side"><Tabs.Trigger value="old">Old</Tabs.Trigger><Tabs.Trigger value="new">New</Tabs.Trigger></Tabs.List>
      <Tabs.Content value="old">Select lines from the old file</Tabs.Content><Tabs.Content value="new">Select lines from the new file</Tabs.Content>
    </Tabs.Root>
    <label>Start line<input type="number" min="1" value={start()} onInput={event => setStart(event.currentTarget.valueAsNumber)} /></label>
    <label>End line<input type="number" min="1" value={end()} onInput={event => setEnd(event.currentTarget.valueAsNumber)} /></label>
    <label class="note-field">Note<textarea value={text()} maxLength={20000} onInput={event => setText(event.currentTarget.value)} ref={element => queueMicrotask(() => element.focus())} /></label>
    <p role="status">{props.notes.list(props.id).length >= 200 ? "Batch full — send or remove notes to add more." : "Choose existing lines on one side."}</p>
    <div class="diff-actions"><button type="button" data-button="quiet" onClick={props.close}>Cancel</button><button type="submit" data-button="quiet" disabled={!valid()}>Save</button></div>
  </form>;
};
