import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { Listbox } from "./Listbox";
import { u501Fixture } from "./u501Fixture";

const answers = [
  { value: "brief", label: "Brief", description: "Keep the summary short" },
  { value: "detail", label: "Detail", description: "Include the reasoning" },
  { value: "full", label: "Full", description: "Include every result" },
];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const mount = () => render(() => u501Fixture({ listbox: Listbox }));

it("u501_arrows_visit_supplied_answers_and_null_in_both_directions", async () => {
  mount();
  const input = screen.getByRole("textbox", { name: "Note" });
  expect(screen.getAllByRole("option").map(item => item.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);

  for (const [key, sequence] of [["ArrowDown", [1, 2, null, 0]], ["ArrowUp", [null, 2, 1, 0]]] as const) {
    for (const index of sequence) {
      fireEvent.keyDown(input, { key });
      await waitFor(() => expect(screen.getAllByRole("option").map(item => item.getAttribute("aria-selected"))).toEqual(answers.map((_, at) => String(at === index))));
      expect(input).toHaveProperty("value", "unchanged draft");
      expect(screen.getAllByRole("option")).toHaveLength(3);

      if (index === null) expect(input.getAttribute("aria-activedescendant")).toBe("");
    }
  }
});

it("u501_names_and_descriptions_come_from_the_caller", () => {
  mount();
  const list = screen.getByRole("listbox", { name: "Answers" });
  const row = screen.getByRole("option", { name: "B · Detailed explanation with a long supplied answer name" });
  expect(list.contains(row)).toBe(true);
  expect(document.getElementById(row.getAttribute("aria-describedby")!)?.textContent).toBe("Include the reasoning and the tradeoffs\nwithout losing the supplied text");
});

it("u501_owner_controls_selection_and_highlight_independently", async () => {
  const [value, setValue] = createSignal<string | null>("brief");
  const [highlight, setHighlight] = createSignal<string | null>("detail");
  const selected: (string | null)[] = [];
  const highlighted: (string | null)[] = [];
  render(() => <Listbox.Root answers={answers} value={value()} highlightedValue={highlight()} onValueChange={value => selected.push(value)} onHighlightChange={value => highlighted.push(value)}>
    <Listbox.Label>Answers</Listbox.Label><Listbox.Content>{answers.map(item => <Listbox.Item item={item} />)}</Listbox.Content>
  </Listbox.Root>);
  const detail = screen.getByRole("option", { name: "Detail" });
  expect(screen.getByRole("listbox").getAttribute("aria-activedescendant")).toBe(detail.id);
  fireEvent.click(screen.getByRole("option", { name: "Full" }));
  await waitFor(() => expect([selected, highlighted]).toEqual([["full"], ["full"]]));
  expect(screen.getByRole("option", { name: "Brief" }).getAttribute("aria-selected")).toBe("true");
  setValue("full");
  setHighlight(null);
  expect(screen.getByRole("option", { name: "Full" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("listbox").getAttribute("aria-activedescendant")).toBe("");
});

for (const state of ["disabled", "pending"] as const) it(`u501_${state}_blocks_answer_changes_and_preserves_the_note`, async () => {
  const [blocked, setBlocked] = createSignal(false);
  const changes: (string | null)[] = [];
  render(() => <Listbox.Root answers={answers} value="brief" highlightedValue="brief" onValueChange={value => changes.push(value)} onHighlightChange={value => changes.push(value)} {...{ get [state]() { return blocked(); } }}>
    <Listbox.Label>Answers</Listbox.Label><Listbox.Content>{answers.map(item => <Listbox.Item item={item} />)}</Listbox.Content>
    <Listbox.NoteInput aria-label="Note" value="keep this draft" onKeyDown={event => { if (event.key === "Enter") changes.push("submitted"); }} />
  </Listbox.Root>);
  const note = screen.getByRole("textbox");
  note.focus();
  setBlocked(true);
  fireEvent.click(screen.getByRole("option", { name: "Full" }));
  fireEvent.keyDown(note, { key: "ArrowDown" });
  fireEvent.keyDown(note, { key: "Enter" });
  await Promise.resolve();
  expect(changes).toEqual([]);
  expect(document.activeElement).toBe(note);
  expect(note).toHaveProperty("readOnly", true);
  expect(note).toHaveProperty("disabled", false);
  expect(note).toHaveProperty("value", "keep this draft");
  expect(screen.getByRole("listbox").getAttribute("aria-disabled")).toBe("true");
});

it("u501_empty_answers_keep_an_own_answer_input", () => {
  render(() => <Listbox.Root answers={[]} value={null} highlightedValue={null} onValueChange={() => undefined} onHighlightChange={() => undefined}>
    <Listbox.NoteInput aria-label="Own answer" />
  </Listbox.Root>);
  expect(screen.queryByRole("listbox")).toBe(null);
  expect(screen.queryAllByRole("option")).toHaveLength(0);
  expect(screen.getByRole("textbox", { name: "Own answer" })).toHaveProperty("readOnly", false);
  expect(screen.getByRole("textbox").getAttribute("aria-controls")).toBe("");
});

it("u501_disposal_removes_navigation_and_callbacks", async () => {
  vi.useFakeTimers();
  const changes: (string | null)[] = [];

  const view = render(() => <Listbox.Root answers={answers} value="brief" highlightedValue="brief" onValueChange={value => changes.push(value)} onHighlightChange={value => changes.push(value)}>
    <Listbox.Label>Answers</Listbox.Label><Listbox.Content>{answers.map(item => <Listbox.Item item={item} />)}</Listbox.Content>
    <Listbox.NoteInput aria-label="Note" />
  </Listbox.Root>);

  const note = screen.getByRole("textbox");
  note.focus();
  view.unmount();
  fireEvent.keyDown(note, { key: "ArrowDown" });
  await vi.runAllTimersAsync();
  expect(vi.getTimerCount()).toBe(0);
  expect(changes).toEqual([]);
  expect(screen.queryByRole("listbox")).toBe(null);
});

it("u501_disabled_answer_is_named_but_skipped_by_ark", async () => {
  const items = answers.map(item => ({ ...item, disabled: item.value === "detail" }));
  render(() => {
    const [value, setValue] = createSignal<string | null>("brief");

    return <Listbox.Root answers={items} value={value()} highlightedValue={value()} onValueChange={setValue} onHighlightChange={setValue}>
      <Listbox.Label>Answers</Listbox.Label><Listbox.Content>{items.map(item => <Listbox.Item item={item} />)}</Listbox.Content>
      <Listbox.NoteInput aria-label="Note" />
    </Listbox.Root>;
  });
  expect(screen.getByRole("option", { name: "Detail" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowDown" });
  await waitFor(() => expect(screen.getByRole("option", { name: "Full" }).getAttribute("aria-selected")).toBe("true"));
});

it("u501_supplied_metadata_keeps_the_option_name_and_description", () => {
  render(() => <Listbox.Root answers={answers} value="brief" highlightedValue="brief" onValueChange={() => undefined} onHighlightChange={() => undefined}>
    <Listbox.Label>Answers</Listbox.Label><Listbox.Content>
      <Listbox.Item item={answers[0]!} class="caller-answer"><span>Recommended</span></Listbox.Item>
    </Listbox.Content>
  </Listbox.Root>);
  const row = screen.getByRole("option", { name: "Brief" });

  expect(row.textContent).toContain("Recommended");
  expect(row.classList.contains("caller-answer")).toBe(true);
  expect(document.getElementById(row.getAttribute("aria-describedby")!)?.textContent).toBe("Keep the summary short");
});

it("u501_multiline_note_exposes_exact_native_value_selection_and_submit_keys", () => {
  const exact = "first\n日本語 é 👩🏽‍💻\nlast";
  const submit = vi.fn();
  const input = vi.fn();
  const selection = vi.fn();
  let editor: HTMLTextAreaElement | undefined;
  render(() => <Listbox.Root answers={answers} value="brief" highlightedValue="brief" onValueChange={() => undefined} onHighlightChange={() => undefined}>
    <Listbox.NoteTextarea aria-label="Decision note" aria-describedby="note-help" value={exact}
      ref={element => { editor = element; }} onInput={event => input(event.currentTarget.value)}
      onSelect={event => selection(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)}
      onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(event.currentTarget.value); } }} />
    <span id="note-help">Extra context</span>
  </Listbox.Root>);
  const note = screen.getByRole("textbox", { name: "Decision note" });
  expect(note).toBe(editor);
  expect(editor?.value).toBe(exact);
  expect(document.getElementById(note.getAttribute("aria-describedby")!)?.textContent).toBe("Extra context");
  editor!.setSelectionRange(6, 12, "backward");
  fireEvent.select(note);
  expect(selection).toHaveBeenCalledWith(6, 12);
  expect(editor?.selectionDirection).toBe("backward");
  expect(fireEvent.keyDown(note, { key: "Enter", shiftKey: true })).toBe(true);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.input(note, { target: { value: exact + "\nnew" } });
  expect(input).toHaveBeenCalledWith(exact + "\nnew");
  fireEvent.keyDown(note, { key: "Enter" });
  expect(submit.mock.calls).toEqual([[exact + "\nnew"]]);
});

it("u501_explicitly_enabled_pending_editor_keeps_ark_selection_and_note_editable_without_focus", async () => {
  const [pending, setPending] = createSignal(false);
  const [value, setValue] = createSignal<string | null>("brief");
  const [note, setNote] = createSignal("newer\n答え");
  render(() => <>
    <button>Other focus</button>
    <Listbox.Root answers={answers} value={value()} highlightedValue={value()} onValueChange={setValue} onHighlightChange={setValue} pending={pending()} disabled={false}>
      <Listbox.Label>Answers</Listbox.Label><Listbox.Content>{answers.map(item => <Listbox.Item item={item} />)}</Listbox.Content>
      <Listbox.NoteTextarea aria-label="Note" value={note()} onInput={event => setNote(event.currentTarget.value)} />
    </Listbox.Root>
  </>);
  const other = screen.getByRole("button");
  other.focus();
  setPending(true);
  expect(document.activeElement).toBe(other);
  expect(screen.getByRole("listbox").parentElement?.getAttribute("aria-busy")).toBe("true");
  const editor = screen.getByRole("textbox");
  expect(editor).toHaveProperty("readOnly", false);
  fireEvent.keyDown(editor, { key: "ArrowDown", altKey: true });
  await waitFor(() => expect(value()).toBe("detail"));
  fireEvent.input(editor, { target: { value: "B\n別の答え 👋" } });
  expect(note()).toBe("B\n別の答え 👋");
  expect(document.activeElement).toBe(other);
});
