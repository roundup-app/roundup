import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import { seedApp } from "../testing/seeds";
import { showEverythingInApp } from "../testing/showEverything";
import { confirmDeletion, stubDialogLayout } from "./bulkQuestionHarness";
import { CHORDS, HELP_ROWS, hintsFor } from "../keys/chords";

afterEach(() => { cleanup(); localStorage.clear(); });

stubDialogLayout();

const open = async (pads = false) => {
  const { app } = seedApp("tree-40", 0);
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  await showEverythingInApp();

  if (pads) {
    fireEvent.click(within(screen.getByRole("tablist", { name: "Work items" })).getByRole("tab", { name: /^Pads/ }));
    await showEverythingInApp();
  }

  const rows = [...document.querySelectorAll<HTMLButtonElement>(pads ? ".shelf .pad-name" : ".shelf .todo-row-button[aria-pressed]")];
  expect(rows.length).toBeGreaterThan(1);

  return { app, rows };
};

const press = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) => {
  target.focus();

  return fireEvent.keyDown(target, { key, code: `Key${key.toUpperCase()}`, ...init });
};

it.each([false, true])("u3723_d_asks_once_to_delete_the_focused_row_and_calls_nothing_first (%s)", async pads => {
  const { app, rows } = await open(pads);
  fireEvent.click(rows[1]!, { metaKey: true });
  press(rows[0]!, "d");
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog.textContent).toContain(rows[0]!.textContent!.trim());
  expect(dialog.textContent).not.toContain(rows[1]!.textContent!.trim());
  expect(app.calls.filter(call => call.method.endsWith(".delete"))).toEqual([]);
  await confirmDeletion();
  await waitFor(() => expect(app.calls.filter(call => call.method === (pads ? "pad.delete" : "todo.delete"))).toHaveLength(1));
});

it("u3723_e_exports_the_focused_pad_and_is_inert_on_a_todo", async () => {
  const { app, rows } = await open();
  press(rows[0]!, "e");
  expect(app.chooser.suggestedNames).toEqual([]);
  cleanup();
  const pad = await open(true);
  press(pad.rows[0]!, "e");
  await waitFor(() => expect(pad.app.chooser.suggestedNames).toHaveLength(1));
  expect(pad.app.calls.filter(call => call.method === "pad.export")).toEqual([]);
  pad.app.chooser.savePath = "/tmp/notes.md";
  press(pad.rows[0]!, "e");
  await waitFor(() => expect(pad.app.calls.filter(call => call.method === "pad.export").map(call => call.params)).toEqual([{ name: pad.rows[0]!.textContent!.trim(), path: "/tmp/notes.md" }]));
});

it("u3723_keys_are_inert_in_text_fields_dialogs_modifiers_and_repeats", async () => {
  const { app, rows } = await open();

  for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) {
    expect(press(rows[0]!, "d", init)).toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  }

  fireEvent.click(screen.getByRole("button", { name: "Add Todo" }));
  const field = screen.getByLabelText("New Todo title");

  for (const key of ["d", "e", "m"]) expect(press(field, key)).toBe(true);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(app.chooser.suggestedNames).toEqual([]);
  press(rows[0]!, "d");
  const dialog = await screen.findByRole("alertdialog");

  for (const key of ["d", "e", "m"]) press(within(dialog).getByRole("button", { name: "Keep" }), key);
  expect(app.calls.filter(call => call.method.endsWith(".delete"))).toEqual([]);
});

it("u3723_keys_are_shelf_scoped_and_leave_the_terminal_alone", async () => {
  await open();
  const terminal = document.body.appendChild(document.createElement("textarea"));
  terminal.className = "xterm-helper-textarea";

  for (const key of ["m", "d", "e"]) expect(press(terminal, key)).toBe(true);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  terminal.remove();
});

it("u3724_each_new_key_is_in_chords_help_and_the_hint_line", async () => {
  const { rows } = await open();
  rows[0]!.focus();
  await waitFor(() => expect(document.querySelector('.hint-line[data-place="shelf"]')).not.toBeNull());

  for (const keys of ["M", "D", "E"]) {
    expect(CHORDS.filter(row => row.keys === keys && row.inShelf)).toHaveLength(1);
    expect(HELP_ROWS.filter(row => row.keys === keys)).toHaveLength(1);
    expect(hintsFor("shelf").filter(row => row.keys === keys)).toHaveLength(1);
    expect(document.querySelector('.hint-line')?.textContent).toContain(keys);
  }
});


it("u3721_maximise_fills_the_centre_and_restore_returns_the_width", async () => {
  const { rows } = await open();
  const centre = document.querySelector(".centre");
  const selected = document.querySelector(".rail-row[data-id]");

  press(rows[0]!, "m");
  expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();
  expect(document.querySelector(".centre")).toBe(centre);
  expect(selected?.isConnected).toBe(true);
  press(rows[0]!, "m");
  expect(screen.getByRole("button", { name: "Maximise" })).toBeTruthy();
});

it("u3722_the_chip_comes_from_the_registry_row", async () => {
  await open();
  const button = screen.getByRole("button", { name: "Maximise" });

  fireEvent.keyDown(document, { key: "Tab" });
  button.focus();
  const tooltip = await screen.findByRole("tooltip");
  const keys = [...tooltip.querySelectorAll("kbd")].map(chip => chip.textContent).join("");
  const row = CHORDS.find(row => row.keys === keys)!;

  fireEvent.keyDown(button, { key: keys.toLowerCase(), code: row.presses[0]! });
  expect(screen.getByRole("button", { name: "Restore" })).toBe(button);
});

it.each(["naming", "drawer"])("u3723_keys_are_inert_in_the_%s_field", async place => {
  const { app, rows } = await open(place === "naming");
  let field: HTMLElement;

  if (place === "naming") {
    fireEvent.click(screen.getByRole("button", { name: "Add Pad" }));
    field = screen.getByLabelText("Pad name");
  } else {
    fireEvent.click(rows[0]!);
    await waitFor(() => expect(document.querySelector(".todo-detail-title .todo-editable p")).not.toBeNull());
    fireEvent.dblClick(document.querySelector(".todo-detail-title .todo-editable p")!);
    field = await screen.findByLabelText("Title");
  }

  for (const key of ["d", "e", "m"]) expect(press(field, key)).toBe(true);
  expect(app.calls.filter(call => call.method.endsWith(".delete") || call.method === "pad.export")).toEqual([]);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
