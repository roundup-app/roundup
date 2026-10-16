import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { Listbox } from "./index";

const answers = [
  { value: "brief", label: "Brief", description: "Keep the summary short" },
  { value: "detail", label: "Detail", description: "Include the reasoning" },
  { value: "full", label: "Full", description: "Include every result" },
];

afterEach(cleanup);

const mount = () => render(() => {
  const [value, setValue] = createSignal<string | null>(answers[0]!.value);
  return <Listbox.Root answers={answers} value={value()} highlightedValue={value()} onValueChange={setValue} onHighlightChange={setValue}>
    <Listbox.Label>Answers</Listbox.Label>
    <Listbox.Content>{answers.map(item => <Listbox.Item item={item} />)}</Listbox.Content>
    <Listbox.NoteInput aria-label="Note" value="unchanged draft" />
  </Listbox.Root>;
});

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
      if (index === null) expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    }
  }
});
