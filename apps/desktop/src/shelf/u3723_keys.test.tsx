import { openProjectPage, projectMenu, questionProbe } from "../testing/menuProbe";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { seedApp } from "../testing/seeds";
import { showEverythingInApp } from "../testing/showEverything";
import { stubDialogLayout } from "./bulkQuestionHarness";
import { captureActions } from "../keys/registry";
import { CHORDS } from "../keys/chords";

afterEach(() => { cleanup(); localStorage.clear(); });

stubDialogLayout();

const open = async (pads = false, unnest?: boolean) => {
  const { app } = seedApp("tree-40", 0);
  // These shortcuts need row identities and a selectable Rail, not the 40-node stress fixture.
  const tree = await app.handlers["rail.tree"]!(null);
  app.handlers["rail.tree"] = () => tree.filter(node => node.id === "backend");

  if (unnest !== undefined) {
    const todos = await app.handlers["todo.list"]!(null);
    app.handlers["todo.list"] = () => todos.slice(0, 2).map(todo => ({ ...todo, blockers: todo.id === 2 && unnest ? [1] : [], blocked: todo.id === 2 && unnest }));
  }

  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  await showEverythingInApp();

  if (pads) {
    fireEvent.click(within(screen.getByRole("tablist", { name: "Bench" })).getByRole("tab", { name: /^Pads/ }));
    await waitFor(() => expect(document.querySelector(".shelf .pad-name")).not.toBeNull());

    for (const control of document.querySelectorAll<HTMLElement>('.shelf [data-shelf-group] [data-part="branch-control"]')) if (control.closest('[role="treeitem"]')?.getAttribute("aria-expanded") === "false") fireEvent.click(control);
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
  await waitFor(() => expect(app.calls.filter(call => call.method === (pads ? "pad.delete" : "todo.delete"))).toHaveLength(1));
});

it("u3723_e_exports_the_focused_pad_and_is_inert_on_a_todo", async () => {
  const { app, rows } = await open();
  press(rows[0]!, "e");
  expect(app.chooser.suggestedNames).toEqual([]);
  cleanup();
  const pad = await open(true);

  for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }]) {
    expect(press(pad.rows[0]!, "e", init)).toBe(true);
  }

  expect(pad.app.chooser.suggestedNames).toEqual([]);
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
    expect(questionProbe.shown).toBeNull();
  }

  fireEvent.click(screen.getByRole("button", { name: "add todo to Overview" }));
  const field = screen.getByLabelText("New Todo title");

  for (const key of ["d", "e", "m"]) expect(press(field, key)).toBe(true);
  expect(questionProbe.shown).toBeNull();
  expect(app.chooser.suggestedNames).toEqual([]);
  expect(app.calls.filter(call => call.method.endsWith(".delete"))).toEqual([]);
});

it("u3723_keys_are_shelf_scoped_and_leave_the_terminal_alone", async () => {
  await open();
  const terminal = document.body.appendChild(document.createElement("textarea"));
  terminal.className = "xterm-helper-textarea";

  for (const key of ["m", "d", "e"]) expect(press(terminal, key)).toBe(true);
  expect(questionProbe.shown).toBeNull();
  expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();
  terminal.remove();
});

it("u3721_maximise_keeps_the_centre_mounted", async () => {
  const { rows } = await open();
  const centre = document.querySelector(".centre");
  const selected = document.querySelector(".rail-row[data-id]");

  press(rows[0]!, "m");
  expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();
  expect(document.querySelector(".centre")).toBe(centre);
  expect(selected?.isConnected).toBe(true);
});

it("u3722_the_chip_comes_from_the_registry_row", async () => {
  await open();
  const shelf = within(document.querySelector<HTMLElement>(".shelf")!);
  const button = shelf.getByRole("button", { name: "Maximise" });

  fireEvent.keyDown(document, { key: "Tab" });
  button.focus();
  const tooltip = await screen.findByRole("tooltip");
  const keys = [...tooltip.querySelectorAll("kbd")].map(chip => chip.textContent).join("");
  const row = CHORDS.find(row => row.keys === keys)!;

  fireEvent.keyDown(button, { key: keys.toLowerCase(), code: row.presses[0]! });
  expect(shelf.getByRole("button", { name: "Restore" })).toBe(button);
});

it.each(["naming", "drawer"])("u3723_keys_are_inert_in_the_%s_field", async place => {
  const { app, rows } = await open(place === "naming");
  let field: HTMLElement;

  if (place === "naming") {
    fireEvent.click(screen.getByRole("button", { name: "Add Pad", hidden: true }));
    field = screen.getByLabelText("Pad name");
  } else {
    fireEvent.keyDown(rows[0]!, { key: "Enter" });
    await waitFor(() => expect(document.querySelector(".todo-detail-title .todo-editable p")).not.toBeNull());
    fireEvent.dblClick(document.querySelector(".todo-detail-title .todo-editable p")!);
    field = await screen.findByLabelText("Title");
  }

  for (const key of ["d", "e", "m"]) expect(press(field, key)).toBe(true);
  expect(app.calls.filter(call => call.method.endsWith(".delete") || call.method === "pad.export")).toEqual([]);
  expect(questionProbe.shown).toBeNull();
});

it("u3787b_shelf_row_commands_are_menu_hints_that_act_once_on_the_focused_row", async () => {
  const { app, rows } = await open();
  rows[0]!.focus();
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:D")?.shortcut).toBe("D"));
  expect(projectMenu.items.find(item => item.id === "action:chord:E")).toBeUndefined();
  expect(document.activeElement).toBe(rows[0]);
  openProjectPage("action:chord:D");
  await waitFor(() => expect(app.calls.filter(call => call.method === "todo.delete")).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "add todo to Overview" }));
  screen.getByLabelText("New Todo title").focus();
  await waitFor(() => expect(projectMenu.items.some(item => item.id === "action:chord:D")).toBe(false));
});


it.each(["A", "W", "X", "C"].flatMap(key => ["key", "menu"].map(source => ({ key, source }))))("u3787b_triage_commands_share_the_focused_todo: $key from $source", async ({ key, source }) => {
  const { app, rows } = await open();
  rows[0]!.focus();
  fireEvent.click(screen.getByRole("button", { name: "Triage" }));
  await waitFor(() => expect(document.querySelector(".shelf")?.getAttribute("data-triage")).toBe("on"));
  const focused = document.activeElement!;
  const id = Number(focused.closest("[data-todo]")!.getAttribute("data-todo"));

  for (const key of ["A", "W", "X", "C"]) {
    await waitFor(() => expect(projectMenu.items.find(item => item.id === `action:chord:${key}`)?.shortcut).toBe(key));
  }

  expect(document.activeElement).toBe(focused);

  if (source === "key") fireEvent.keyDown(focused, { key: key.toLowerCase(), code: `Key${key}` });
  else openProjectPage(`action:chord:${key}`);

  if (key === "X") await waitFor(() => expect(app.calls.filter(call => call.method === "todo.complete").map(call => call.params)).toEqual([{ id }]));
  else if (key === "C") {
    const field = await screen.findByRole("textbox", { name: "Write a comment" });
    fireEvent.input(field, { target: { value: "reviewed" } });
    fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
    await waitFor(() => expect(app.calls.filter(call => call.method === "todo.comment").map(call => call.params)).toEqual([{ id, body: "reviewed" }]));
  } else {
    const menu = await screen.findByRole("menu", { name: `${key === "A" ? "Owners" : "Homes"} for #${id}` });
    expect(screen.getAllByRole("menu")).toEqual([menu]);
  }
});

it("u3787b_triage_menu_refuses_an_owner_after_leaving_the_mode", async () => {
  const { app, rows } = await open();
  rows[0]!.focus();
  fireEvent.click(screen.getByRole("button", { name: "Triage" }));
  await waitFor(() => expect(projectMenu.items.some(item => item.id === "action:chord:X")).toBe(true));
  const captured = captureActions(document.activeElement).find(action => action.value === "action:chord:X")!;
  fireEvent.keyDown(document.activeElement!, { key: "Escape", code: "Escape" });
  await waitFor(() => expect(projectMenu.items.some(item => item.id === "action:chord:X")).toBe(false));
  expect(fireEvent.keyDown(document.activeElement!, { key: "x", code: "KeyX" })).toBe(true);
  openProjectPage("action:chord:X");
  captured.run();
  expect(app.calls.filter(call => call.method === "todo.complete")).toEqual([]);
});


it.each([false, true].flatMap(out => ["key", "menu"].map(source => ({ out, source }))))("u3787b_nesting_captures_the_focused_todo_once: out=$out from $source", async ({ out, source }) => {
  const { app } = await open(false, out);
  const row = document.querySelector<HTMLButtonElement>('[data-todo="2"] .todo-row-button[aria-pressed]')!;
  row.focus();
  const chord = out ? "⇧Tab" : "Tab";
  await waitFor(() => expect(projectMenu.items.find(item => item.id === `action:chord:${chord}`)?.shortcut).toBe(chord));
  const captured = captureActions(row).find(action => action.keys === chord)!;
  expect(document.activeElement).toBe(row);

  if (source === "key") fireEvent.keyDown(row, { key: "Tab", code: "Tab", shiftKey: out });
  else openProjectPage(`action:chord:${chord}`);

  await waitFor(() => expect(app.calls.filter(call => call.method === "todo.setBlockers").map(call => call.params)).toEqual([{ id: 2, blockers: out ? [] : [1] }]));
  fireEvent.click(screen.getByRole("button", { name: "add todo to Overview" }));
  screen.getByLabelText("New Todo title").focus();
  await waitFor(() => expect(projectMenu.items.some(item => item.id === `action:chord:${chord}`)).toBe(false));
  captured.run();
  openProjectPage(`action:chord:${chord}`);
  expect(app.calls.filter(call => call.method === "todo.setBlockers")).toHaveLength(1);
});
