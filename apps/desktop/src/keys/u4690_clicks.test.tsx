import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { openTabs } from "../header/stripFixture";
import { agent } from "../testing/nodes";
import { HintLine } from "./HintLine";
import { mountTodos, todo } from "../todos/testHarness";
import { ConnectedProjectContext } from "../state/connectedProject";
import { RpcError } from "../app/seam";
import { leaderArmed } from "./registry";

afterEach(cleanup);

it("u4690b_leader_clicks_and_keys_share_one_wait", async () => {
  await openTabs({ api: [agent("a1", "needs-you", "x")] });
  const row = document.querySelector<HTMLElement>(".rail-row")!;
  row.focus();
  await waitFor(() => expect(document.querySelector('.hint-line [data-hint="⌘K"]')).not.toBeNull());
  fireEvent.click(document.querySelector('.hint-line [data-hint="⌘K"]')!);
  expect(leaderArmed()).toBe(true);
  const choice = document.querySelector<HTMLButtonElement>('.hint-line [data-hint="K"]')!;
  fireEvent.pointerDown(choice);
  expect(leaderArmed()).toBe(true);
  fireEvent.click(choice);
  await waitFor(() => expect(document.querySelector('.switcher input')).not.toBeNull());
  expect(leaderArmed()).toBe(false);
});

it.each(["key", "pointer", "button"] as const)("u4690_each_hint_runs_its_key_action_once: Ask %s", async source => {
  const { app } = await openTabs({ api: [agent("a1", "idle", "x")] });
  const row = document.querySelector<HTMLElement>(".rail-row")!;
  row.focus();
  await waitFor(() => expect(document.querySelector('.hint-line [data-hint="⌘/"]')).not.toBeNull());
  if (source === "key") fireEvent.keyDown(row, { key: "/", code: "Slash", metaKey: true });
  else {
    const button = document.querySelector<HTMLButtonElement>('.hint-line [data-hint="⌘/"]')!;
    if (source === "button") button.focus();
    else fireEvent.pointerDown(button);
    fireEvent.click(button);
  }
  await waitFor(() => expect(document.activeElement?.closest(".ask-bar")).not.toBeNull());
  expect(document.querySelectorAll(".ask-input")).toHaveLength(1);
  expect(app.calls.filter(call => call.method === "terminal.write")).toEqual([]);
});

it.each([1, 9])("u4690d_each_number_assigns_its_key_target_once: %s", async number => {
  for (const source of ["key", "pointer"] as const) {
    const { app, connected } = await mountTodos([todo(1)], true, Array.from({ length: 9 }, (_, at) => agent(`a${at + 1}`, "idle", "x", { name: `Agent ${at + 1}`, order: at })));
    render(() => <ConnectedProjectContext.Provider value={connected}><HintLine /></ConnectedProjectContext.Provider>);
    const row = document.querySelector<HTMLButtonElement>('[data-todo="1"] .row-head .todo-row-button')!;
    row.focus();
    await waitFor(() => expect(document.querySelector(`.hint-line [data-hint="Digit${number}"]`)).not.toBeNull());
    if (source === "key") fireEvent.keyDown(row, { key: String(number), code: `Digit${number}` });
    else fireEvent.click(document.querySelector(`.hint-line [data-hint="Digit${number}"]`)!);
    await waitFor(() => expect(app.calls.filter(call => call.method === "todo.assign").map(call => call.params)).toEqual([{ id: 1, owner: { kind: "agent", id: `a${number}`, parent: null } }]));
    expect(app.calls.filter(call => call.method === "terminal.write")).toEqual([]);
    cleanup();
  }
});

it("u4690c_unavailable_or_stale_hints_run_nothing", async () => {
  const { app, connected } = await mountTodos([todo(1)], true, [agent("a1", "idle", "x")]);
  render(() => <ConnectedProjectContext.Provider value={connected}><HintLine /></ConnectedProjectContext.Provider>);
  const row = document.querySelector<HTMLButtonElement>('[data-todo="1"] .row-head .todo-row-button')!;
  row.focus();
  await waitFor(() => expect(document.querySelector('.hint-line [data-hint="Digit1"]')).not.toBeNull());
  const stale = document.querySelector<HTMLButtonElement>('.hint-line [data-hint="Digit1"]')!;
  fireEvent.pointerDown(stale);
  app.handlers["rail.tree"] = () => [];
  await connected.rail.refresh();
  fireEvent.click(stale);
  expect(app.calls.filter(call => call.method === "todo.assign" || call.method === "terminal.write")).toEqual([]);
});

it.each(["key", "pointer"] as const)("u4690c_rejected_hint_uses_key_failure_path: %s", async source => {
  const { app, connected, store } = await mountTodos([todo(1)], true, [agent("a1", "idle", "x")]);
  render(() => <ConnectedProjectContext.Provider value={connected}><HintLine /></ConnectedProjectContext.Provider>);
  app.handlers["todo.assign"] = () => { throw new RpcError(-32003, "Assignment refused: retry after reconnecting"); };
  const row = document.querySelector<HTMLButtonElement>('[data-todo="1"] .row-head .todo-row-button')!;
  row.focus();
  await waitFor(() => expect(document.querySelector('.hint-line [data-hint="Digit1"]')).not.toBeNull());
  if (source === "key") fireEvent.keyDown(row, { key: "1", code: "Digit1" });
  else fireEvent.click(document.querySelector('.hint-line [data-hint="Digit1"]')!);
  await waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("Assignment refused"));
  expect(app.calls.filter(call => call.method === "todo.assign")).toHaveLength(1);
  expect(store.todos[0]).toMatchObject({ id: 1, owner: null });
  expect(document.activeElement).toBe(row);
});
