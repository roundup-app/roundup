import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { batch, createRoot } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { mountNavigation } from "../testing/navigationFixture";
import { openProjectPage, projectMenu } from "../testing/menuProbe";
import { ACTION_ROWS, CHORDS, HELP_ROWS } from "./chords";
import { listActions, runAction } from "./actions";
import { captureActions, registerKeys } from "./registry";

const disposals: (() => void)[] = [];

afterEach(() => { disposals.splice(0).forEach(dispose => dispose()); batch(cleanup); localStorage.clear(); });

const PINNED = `agent.new agent.new-with-prompt workstream.new mode.new terminal.new leader.open switcher.open attention.jump todo.capture terminal.switch rail.collapse-expand rail.move rail.rename help.open
agent.restart-mode rail.remove ask.open todo.assign-slot todo.open-draft todo.add todo.assign shelf.maximise todo.delete todo.export shelf.close terminal.text-larger terminal.text-smaller
terminal.text-reset editor.quote editor.bullet-list editor.numbered-list editor.code-block editor.italic editor.inline-code terminal.find edit.undo edit.redo settings.open settings.forward
todo.triage-enter todo.triage-move todo.triage-assign todo.triage-workstream todo.triage-nest todo.triage-unnest todo.triage-done todo.triage-comment todo.triage-leave project.choose-folder
leader.assign leader.project leader.changes leader.attention leader.attention-other-project leader.row leader.bubble-minimise leader.bubble-close leader.shelf leader.capture leader.inbox`.split(/\s+/);

const probe = (element: Element, name = "terminal.find") => {
  const calls: unknown[] = [];

  createRoot(dispose => {
    disposals.push(dispose);
    // SAFETY: the probe region only reads `contains`, which any Element has.
    registerKeys({ kind: "region", element: () => element as HTMLElement }, [{
      action: ACTION_ROWS.find(row => row.name === name)!,
      capture: focus => ({ available: () => !!focus && element.contains(focus), invoke: args => { calls.push(args ?? null); } }),
    }]);
  });

  return calls;
};

const mountTerminal = async () => {
  const mounted = await mountNavigation(false, 0);
  mounted.connected().rail.select("a1");
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("t-a1"));

  // SAFETY: the wait above proved focus is on the terminal element.
  return { ...mounted, terminal: document.activeElement as HTMLElement };
};

it("na1_every_entry_has_a_unique_stable_name", () => {
  const names = ACTION_ROWS.map(row => row.name);
  expect(names).toHaveLength(CHORDS.length + 11);
  expect(new Set(names).size).toBe(names.length);
  expect(names.every(name => /^[a-z]+(-[a-z]+)*\.[a-z]+(-[a-z]+)*$/.test(name))).toBe(true);
  expect(ACTION_ROWS.flatMap(row => row.args ?? []).every(arg => ["string", "integer", "boolean", "choice"].includes(arg.type))).toBe(true);
  expect(names.toSorted()).toEqual(PINNED.toSorted());
});

it("na2_menu_key_and_switcher_run_one_action_by_name", async () => {
  const { terminal } = await mountTerminal();
  const calls = probe(terminal);
  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:⌘F")?.enabled).toBe(true));
  const switcher = captureActions(terminal).find(action => action.name === "terminal.find")!;
  const menu = projectMenu.items.find(item => item.id === "action:chord:⌘F")!;
  expect([menu.label, menu.shortcut]).toEqual([switcher.label, switcher.keys]);
  expect(HELP_ROWS.some(row => row.keys === switcher.keys && row.what === switcher.label)).toBe(true);

  fireEvent.keyDown(terminal, { code: "KeyF", key: "f", metaKey: true });
  expect(calls).toHaveLength(1);
  openProjectPage("action:chord:⌘F", "/p");
  expect(calls).toHaveLength(2);
  switcher.run();
  expect(calls).toHaveLength(3);
  expect(runAction("terminal.find", [], terminal)).toEqual({ status: "done" });
  expect(calls).toHaveLength(4);
});

it.each([
  ["unknown name", "terminal.nope", [], "unknown-action", "terminal.nope"],
  ["unknown argument", "terminal.find", [["x", "1"]], "unknown-argument", "x"],
  ["missing required", "todo.assign-slot", [], "missing-argument", "slot"],
  ["mistyped", "todo.assign-slot", [["slot", "two"]], "invalid-argument", "slot"],
  ["out of bounds", "todo.assign-slot", [["slot", "10"]], "invalid-argument", "slot"],
  ["bad choice", "todo.triage-move", [["direction", "left"]], "invalid-argument", "direction"],
  ["repeated", "leader.row", [["query", "a"], ["query", "b"]], "repeated-argument", "query"],
] as const)("na3_run_by_name_checks_name_and_arguments_then_runs_once: %s", async (_case, name, pairs, code, mention) => {
  const { terminal } = await mountTerminal();
  const calls = probe(terminal, ACTION_ROWS.some(row => row.name === name) ? name : "terminal.find");
  const result = runAction(name, pairs, terminal);
  expect(result).toMatchObject({ status: "refused", code });
  expect(result.status === "refused" && result.message).toContain(mention);
  expect(calls).toEqual([]);
});

it("na3_run_by_name_checks_name_and_arguments_then_runs_once: valid call passes typed arguments once", async () => {
  const { terminal } = await mountTerminal();
  const calls = probe(terminal, "leader.row");
  expect(runAction("leader.row", [["query", "a1"]], terminal)).toEqual({ status: "done" });
  expect(calls).toEqual([{ query: "a1" }]);
});

it("na4_availability_and_input_ownership_match_the_key", async () => {
  const { terminal } = await mountTerminal();
  const calls = probe(terminal);
  expect(listActions(terminal).find(row => row.name === "terminal.find")?.available).toBe(true);
  const editor = document.createElement("textarea");
  document.body.append(editor);
  editor.focus();
  const row = listActions(editor).find(each => each.name === "terminal.find");
  expect(row).toMatchObject({ available: false, cause: expect.any(String) });
  const typed = editor.value;
  expect(runAction("terminal.find", [], editor)).toMatchObject({ status: "refused", code: "unavailable" });
  expect(calls).toEqual([]);
  expect(editor.value).toBe(typed);
  expect(listActions(terminal).find(each => each.name === "rail.move")).toMatchObject({ available: false, cause: "needs a Rail row" });
});

it("na5_list_rows_carry_name_label_keys_arguments_and_availability", async () => {
  await mountTerminal();
  const rows = listActions();
  expect(rows.map(row => row.name)).toEqual(ACTION_ROWS.map(row => row.name));
  expect(new Set(rows.map(row => row.name)).size).toBe(rows.length);
  expect(rows.find(row => row.name === "leader.attention")).toMatchObject({ keys: "⌘K J", label: expect.any(String), args: [] });
  expect(rows.find(row => row.name === "todo.assign-slot")?.args).toMatchObject([{ key: "slot", type: "integer", min: 1, max: 9, required: true }]);
  expect(rows.find(row => row.name === "todo.capture")?.keys).toBe(CHORDS.find(row => row.name === "todo.capture")!.keys);
  expect(rows.every(row => row.available || row.cause !== undefined)).toBe(true);
});
