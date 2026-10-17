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

it("u501_own_answer_callbacks_report_null_to_the_owner", async () => {
  const selected: (string | null)[] = [];
  const highlighted: (string | null)[] = [];
  render(() => <Listbox.Root answers={answers} value="brief" highlightedValue="brief" onValueChange={value => selected.push(value)} onHighlightChange={value => highlighted.push(value)}>
    <Listbox.Label>Answers</Listbox.Label><Listbox.Content>{answers.map(item => <Listbox.Item item={item} />)}</Listbox.Content>
    <Listbox.NoteInput aria-label="Note" />
  </Listbox.Root>);
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowUp" });
  await waitFor(() => expect([selected, highlighted]).toEqual([[null], [null]]));
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
