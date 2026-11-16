import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { Combobox } from "./Combobox";

afterEach(cleanup);

const choices = [
  { value: "a", label: "First" },
  { value: "b", label: "Second" },
  { value: "c", label: "Third" },
];

const mountChoices = () => {
  const highlights: (string | null)[] = [];
  const onSelect = vi.fn();

  render(() => {
    const [highlight, setHighlight] = createSignal<string | null>(null);
    const [query, setQuery] = createSignal("");

    return (
      <>
        <button type="button">Elsewhere</button>
        <Combobox.Root
          items={choices}
          highlightedValue={highlight()}
          onHighlightChange={(value) => {
            highlights.push(value);
            setHighlight(value);
          }}
          inputValue={query()}
          onInput={setQuery}
          onSelect={onSelect}
          onDismiss={() => {}}
          label="Model"
          placeholder="Model"
          empty="No match"
          row={(item) => item.label}
        />
      </>
    );
  });

  return {
    highlights,
    onSelect,
    input: screen.getByRole<HTMLInputElement>("combobox", { name: "Model" }),
  };
};

it("combobox_home_and_end_move_the_highlight_to_the_first_and_last_choice", () => {
  const { highlights, input } = mountChoices();
  input.focus();

  expect(fireEvent.keyDown(input, { key: "End" })).toBe(false);
  expect(highlights.at(-1)).toBe("c");

  expect(fireEvent.keyDown(input, { key: "Home" })).toBe(false);
  expect(highlights.at(-1)).toBe("a");

  // A control chord keeps its native meaning: the highlight stays on the first choice.
  expect(fireEvent.keyDown(input, { key: "End", ctrlKey: true })).toBe(true);
  expect(highlights.at(-1)).toBe("a");
});

it("combobox_a_pick_returns_focus_to_the_input", async () => {
  const { onSelect, input } = mountChoices();
  const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
  elsewhere.focus();
  expect(document.activeElement).toBe(elsewhere);

  fireEvent.click(await screen.findByText("Second"));

  expect(onSelect.mock.calls).toEqual([["b"]]);
  await waitFor(() => expect(document.activeElement).toBe(input));
});
