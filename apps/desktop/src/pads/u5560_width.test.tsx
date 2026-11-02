import userEvent from "@testing-library/user-event";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { openPad, openShelf, padOf } from "./padsFixture";
import { USER } from "../testing/nodes";

afterEach(() => { cleanup(); localStorage.clear(); });

it.each(["Narrow", "Wide", "Full"].flatMap(choice => ["pointer", "key"].map(source => [choice, source])))("u5560a_expanded_pad_changes_width_without_writing %s %s", async (choice, source) => {
  const { app, state } = await openShelf([padOf("note", USER, "original")]);
  await openPad("note");
  const group = await screen.findByRole("radiogroup", { name: "Width" });
  const pad = structuredClone(state.pads[0]);
  const editor = screen.getByRole("textbox", { name: "Pad body" });
  const before = localStorage.getItem("roundup:app-settings");
  app.calls.length = 0;

  if (source === "pointer") fireEvent.click(within(group).getByRole("radio", { name: choice }));
  else {
    const initial = within(group).getByRole("radio", { name: "Narrow" });
    const user = userEvent.setup();
    initial.focus();

    for (const name of ["Wide", "Full", "Narrow"].slice(0, choice === "Wide" ? 1 : choice === "Full" ? 2 : 3)) {
      await user.keyboard("{ArrowRight}");
      await waitFor(() => expect(within(group).getByRole<HTMLInputElement>("radio", { name }).checked).toBe(true));
    }
  }

  await waitFor(() => expect(within(group).getByRole<HTMLInputElement>("radio", { name: choice }).checked).toBe(true));
  expect(within(group).getAllByRole<HTMLInputElement>("radio").filter(input => input.checked)).toHaveLength(1);
  expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(0);
  expect(localStorage.getItem("roundup:app-settings")).toBe(before);
  expect(state.pads[0]).toEqual(pad);
  expect(screen.getByRole("textbox", { name: "Pad body" })).toBe(editor);
});

it("u5560a_width_choice_lasts_for_the_open_pad", async () => {
  const { app } = await openShelf([padOf("note", USER, "original")]);
  const editor = await openPad("note");
  fireEvent.click(await screen.findByRole("radio", { name: "Full" }));
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>("radio", { name: "Full" }).checked).toBe(true));
  fireEvent.input(editor, { target: { value: "exact unfinished  \ntext" } });
  const text = editor.value;
  app.calls.length = 0;
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Maximise" }));
  await waitFor(() => expect(screen.getByRole<HTMLInputElement>("radio", { name: "Full" }).checked).toBe(true));
  expect(screen.getByRole("textbox", { name: "Pad body" })).toBe(editor.querySelector("[contenteditable]"));
  expect(editor.value).toBe(text);
  expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(0);
});
