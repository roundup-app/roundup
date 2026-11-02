import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { openPad, openShelf, padOf } from "./padsFixture";
import { USER } from "../testing/nodes";

afterEach(() => { cleanup(); localStorage.clear(); });

it.each(["Narrow", "Wide", "Full"])("u5560a_expanded_pad_changes_width_without_writing %s", async choice => {
  const { app } = await openShelf([padOf("note", USER, "original")]);
  await openPad("note");
  const group = await screen.findByRole("radiogroup", { name: "Width" });
  const before = localStorage.getItem("roundup:app-settings");
  app.calls.length = 0;
  fireEvent.click(within(group).getByRole("radio", { name: choice }));
  await waitFor(() => expect(within(group).getByRole<HTMLInputElement>("radio", { name: choice }).checked).toBe(true));
  expect(within(group).getAllByRole<HTMLInputElement>("radio").filter(input => input.checked)).toHaveLength(1);
  expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(0);
  expect(localStorage.getItem("roundup:app-settings")).toBe(before);
});

it("u5560a_width_choice_lasts_for_the_open_pad", async () => {
  const { app } = await openShelf([padOf("note", USER, "original")]);
  const editor = await openPad("note");
  fireEvent.click(await screen.findByRole("radio", { name: "Full" }));
  fireEvent.input(editor, { target: { value: "exact unfinished  \ntext" } });
  const text = editor.value;
  app.calls.length = 0;
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  expect(screen.queryAllByRole("radio")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Maximise" }));
  expect((await screen.findByRole<HTMLInputElement>("radio", { name: "Full" })).checked).toBe(true);
  expect(screen.getByRole("textbox")).toBe(editor);
  expect(editor.value).toBe(text);
  expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(0);
});
