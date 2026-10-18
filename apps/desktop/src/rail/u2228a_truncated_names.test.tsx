import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { CHORDS } from "../keys/chords";
import { RowIcons } from "./RowIcons";
import { copy } from "../copy";
import { workstream } from "../testing/nodes";
import { mountRail, rowOf } from "./railFixture";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NAME = `payments workstream ${"with a very long tail ".repeat(3)}`.trim();

/** jsdom has no layout: a `.name` box 100 wide holds as many characters as it has text length. */
const layout = (width: number) => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(width);
};

const nameOf = (name: string) => rowOf(name).querySelector<HTMLElement>(".name")!;

/** The row, not its name, carries the Tooltip trigger, so any point of it reaches it. */
const hoverRow = (name: string) => fireEvent.pointerMove(rowOf(name), { pointerType: "mouse" });

it("u2228a_a_truncated_workstream_name_has_its_full_text", async () => {
  layout(400);
  await mountRail([workstream("w", { name: NAME })]);

  expect(nameOf(NAME).textContent).toBe(NAME);
  expect(nameOf(NAME).hasAttribute("title")).toBe(false);
  await waitFor(() => hoverRow(NAME));
  expect((await screen.findByRole("tooltip")).textContent).toBe(NAME);
});

it("u2228a_a_name_that_fits_has_no_tooltip", async () => {
  layout(50);
  await mountRail([workstream("w", { name: NAME })]);

  await Promise.resolve();
  hoverRow(NAME);
  await new Promise((done) => setTimeout(done, 600));
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(nameOf(NAME).hasAttribute("title")).toBe(false);
});

it("u2228a_the_add_agent_tooltip_stays", async () => {
  layout(400);
  await mountRail([workstream("w", { name: NAME })]);

  const add = rowOf(NAME).querySelector<HTMLElement>(".rail-add-label")!.closest("button")!;
  hoverRow(NAME);
  await screen.findByRole("tooltip");
  fireEvent.pointerMove(add, { pointerType: "mouse" });
  await waitFor(() => expect(screen.queryByText(NAME, { selector: "[role=tooltip] *, [role=tooltip]" })).toBeNull());
  fireEvent.keyDown(document, { key: "Tab" });
  add.focus();
  await waitFor(() => expect(screen.getAllByRole("tooltip").map((tip) => tip.textContent)).toContain(copy.addAgentN));
});

it.each(["hover", "focus"])("u2570a_tooltips_follow_their_chord_%s", async (input) => {
  const chord = CHORDS[0]!;
  const original = chord.keys;
  const add = vi.fn();

  // A different table spelling must reach every instance without changing caller copy.
  chord.keys = "⌥Z";
  try {
    render(() => <>{[1, 2].map(() => <RowIcons actions={{ kind: "workstream", add: { disabled: false, run: add }, folder: () => {}, editor: () => {} }} />)}</>);
    const buttons = screen.getAllByRole("button", { name: copy.addAgentLabel });

    for (const button of buttons) {
      if (input === "hover") fireEvent.pointerMove(button, { pointerType: "mouse" });
      else { fireEvent.keyDown(document, { key: "Tab" }); button.focus(); }
      const tip = await screen.findByRole("tooltip");

      expect([...tip.querySelectorAll("kbd")].map((key) => key.textContent).join("")).toBe("⌥Z");
      fireEvent.click(button);
      if (input === "hover") fireEvent.pointerLeave(button, { pointerType: "mouse" });
      else button.blur();
      await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    }
    expect(add).toHaveBeenCalledTimes(2);
  } finally { chord.keys = original; }
});
