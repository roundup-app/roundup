import { isDoor } from "../state/doorNode";
import { copy } from "./copy";
import { open, target } from "./u3789RowsHarness";
import { questionDialog, answerQuestion } from "./bulkQuestionHarness";
import { settled } from "../rail/railFixture";
import { mountTodos, todo } from "../todos/testHarness";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { NOW_TICK_MS } from "../state/clock";
import { USER } from "../testing/nodes";
import type { seedApp } from "../testing/seeds";
import { rpcCalls } from "../testing/appFixture";

afterEach(() => cleanup());

it.each(["payments", "tokens", "auth"].flatMap(id => [false, true].map(withWorktree => ({id, withWorktree}))))("u4275b_quick_actions_use_the_rows_directory_$id/$withWorktree", async ({id, withWorktree}) => {
  const { app } = await open("tree-40", ["backend", "payments", "auth", "tokens"], withWorktree);
  const row = document.querySelector<HTMLElement>(`.rail-row[data-id="${id}"]`)!;
  const node = (await app.rpc("rail.tree", null)).filter(isDoor).find(node => node.id === id)!;
  const directory = node.worktree?.path ?? "/Users/you/harness";
  fireEvent.contextMenu(row);
  await app.pickMenu(copy.openFolder);
  await waitFor(() => expect(app.openedTargets).toEqual([{ kind: "path", path: directory, line: null }]));
  fireEvent.contextMenu(row);
  await app.pickMenu(copy.openInEditor);
  await waitFor(() => expect(app.editorOpened).toEqual([directory]));
  expect(document.querySelector('.rail-row[data-selected]')?.getAttribute("data-id")).toBe(id);
});

it("u4275a_state_updates_without_row_activation", async () => {
  const { setStatus, app } = await open("tree-40", ["backend", "payments", "auth", "tokens"]);
  const row = document.querySelector('.rail-row[data-id="tokens"]')!;
  const selected = document.querySelector('.rail-row[data-selected]')?.getAttribute("data-id");

  for (const kind of ["idle", "working", "needs-you", "blocked", "error"] as const) {
    const identity = kind === "needs-you" ? copy.needsYouGlyph : kind[0]!.toUpperCase() + kind.slice(1);
    const label = `${kind} detail`;

    setStatus("tokens", kind, label);
    // U7205a: the glyph's accessible name is the state identity then the status words, so a name left over from the previous state fails.
    await waitFor(() => expect(row.querySelector('.row-state [role=img]')?.getAttribute("aria-label")).toBe(`${identity}, ${label}`));
  }

  fireEvent.click(document.querySelector('.shelf-done-line .todo-row-button')!);
  await waitFor(() => expect(document.querySelector('.todos-tab [data-todo="7"]')).not.toBeNull());
  await app.rpc("todo.setBlockers", {id: 1, blockers: [2]});
  await waitFor(() => expect(document.querySelector('.todos-tab [data-todo="1"] [role=img]')?.getAttribute("aria-label")).toBe(copy.blocked));
  await app.rpc("todo.setBlockers", {id: 1, blockers: []});
  await app.rpc("todo.complete", { id: 1 });
  await waitFor(() => expect(document.querySelector('.todos-tab [data-todo="1"] [role=img]')?.getAttribute("aria-label")).toBe(copy.done));
  expect(document.querySelector('.rail-row[data-selected]')?.getAttribute("data-id")).toBe(selected);
});

it("u4275c_rows_keep_details_in_the_opened_todo_return", async () => {
  const { app, row } = await target("todo-shelf");
  const authored = await app.rpc("todo.update", { id: 1, title: "Name only", body: "Private multiline body\nSecond detail" });
  await waitFor(() => expect(row.textContent).toContain(authored.title));
  const before = app.calls.length;
  fireEvent.click(row);
  flush();
  expect(row.closest('.shelf-row')!.textContent).not.toContain(authored.body!.split("\n")[0]!);

  fireEvent.keyDown(row, { key: "Enter" });
  await waitFor(() => expect(document.querySelector('.drawer[data-open=true]')?.textContent).toContain(authored.body!.split("\n")[0]!));
  expect(app.calls.slice(before).filter(call => ["todo.update", "todo.complete", "todo.move"].includes(call.method))).toEqual([]);
});

it("u4275b_row_actions_keep_menu_semantics_stop_cancellation", async () => {
  const { app } = await open("tree-40", ["backend", "auth", "tokens"]);
  const row = document.querySelector('.rail-row[data-id="tokens"]')!;
  fireEvent.click(row.querySelector('[aria-label="Stop"]')!);
  await questionDialog();
  expect(rpcCalls(app, "agent.stop")).toEqual([]);
  await answerQuestion(false);
  expect(rpcCalls(app, "agent.stop")).toEqual([]);
  fireEvent.click(row.querySelector('[aria-label="Stop"]')!);
  await questionDialog();
  await answerQuestion(true);
  await waitFor(() => expect(rpcCalls(app, "agent.stop")).toEqual([{id:"tokens"}]));
});

it("u4275b_row_actions_keep_menu_semantics_stopped_door", async () => {
  const { app } = await open("door-stopped");
  const row = document.querySelector<HTMLElement>('.rail-row')!;
  const id = row.getAttribute("data-id")!;
  fireEvent.click(within(row).getByRole("button", { name: copy.startDoor }));
  await waitFor(() => expect(rpcCalls(app, "rail.startDoor")).toEqual([{id}]));
});

it("u4275b_row_actions_keep_menu_semantics_resume", async () => {
  const { app, emit } = await open("tree-40", ["backend", "auth", "tokens"]);
  const tree = await app.rpc("rail.tree", null);
  const node = tree.filter(isDoor).find(node => node.id === "tokens")!;
  node.can_resume = true;
  app.handlers["agent.resume"] = () => node;
  await app.rpc("agent.stop", {id:"tokens"});
  emit({ actor: {kind:"user",id:"you",parent:null}, name:"rail.changed" });
  const row = document.querySelector('.rail-row[data-id="tokens"]')!;
  await waitFor(() => expect(row.querySelector('[aria-label="Restart"]')).not.toBeNull());
  fireEvent.click(row.querySelector('[aria-label="Restart"]')!);
  await waitFor(() => expect(rpcCalls(app, "agent.resume")).toEqual([{id:"tokens",mode:"normal"}]));
});

const ageFixture = async ({app}: ReturnType<typeof seedApp>) => {
  const todos = (await app.rpc("todo.list", null)).slice(0, 2);
  const pads = (await app.rpc("pad.list", null)).slice(0, 2).map(pad => ({...pad, home:null}));
  app.handlers["todo.list"] = () => todos;
  app.handlers["pad.list"] = () => pads;
};

const itemRow = (kind: "todos" | "pads") => document.querySelector<HTMLElement>(kind === "todos" ? '.todos-tab [data-todo="1"]' : '.pads-tab [data-pad="a-pad-with-a-very-long-name-here"]')!;

it.each(["todos", "pads"] as const)("u4709a_rows_use_updated_at_%s", async kind => {
  const now = new Date(2026, 9, 30, 12).getTime();
  await open("tree-40", [], false, kind === "todos" ? copy.todos : copy.pads, () => now, async (controls) => {
    await ageFixture(controls);
    const {app} = controls;

    if (kind === "todos") {
      const items = await app.rpc("todo.list", null);
      app.handlers["todo.list"] = () => items.map(item => ({...item, created_at: 0, updated_at: now - 300000}));
    } else {
      const items = await app.rpc("pad.list", null);
      app.handlers["pad.list"] = () => items.map(item => ({...item, updated_at: new Date(2026, 8, 12, 12).getTime()}));
    }
  });
  expect(itemRow(kind).querySelector(".item-age")?.textContent).toBe(kind === "todos" ? "5m" : "2026-09-12");
});

it.each([{kind:"todos", expectedAge:"1m"}, {kind:"pads", expectedAge:"1m"}] as const)("u4709b_live_tick_updates_resting_rows_$kind", async ({kind, expectedAge}) => {
  let now = 59000;
  vi.useFakeTimers({toFake: ["setInterval", "clearInterval"]});
  const {app, view} = await open("tree-40", [], false, kind === "todos" ? copy.todos : copy.pads, () => now, ageFixture);
  const before = app.calls.length;

  try {
    now = 60000;
    await vi.advanceTimersByTimeAsync(NOW_TICK_MS);
    expect(itemRow(kind).querySelector(".item-age")?.textContent).toBe(expectedAge);
    expect(app.calls.slice(before)).toEqual([]);
  } finally { view.unmount(); vi.useRealTimers(); }
});

it.each([{kind:"todos", expectedAge:"5m"}, {kind:"pads", expectedAge:"5m"}] as const)("u4709b_events_update_create_and_rename_rows_$kind", async ({kind, expectedAge}) => {
  const now = 7200000;
  const {app, emit} = await open("tree-40", [], false, kind === "todos" ? copy.todos : copy.pads, () => now, ageFixture);
  const existing = document.querySelector<HTMLElement>(kind === "todos" ? '.todos-tab [data-todo="2"]' : '.pads-tab [data-pad="pad-0"]')!;
  const nameButton = existing.querySelector<HTMLElement>(kind === "todos" ? ".todo-row-button" : ".pad-name")!;
  fireEvent.click(nameButton);
  await settled();
  const selected = existing.getAttribute("data-selected");
  const folds = () => [...document.querySelectorAll('[data-shelf-group]')].map(row => [row.getAttribute('data-shelf-group'), row.querySelector(':scope > .shelf-group-head .shelf-group-control')?.getAttribute('aria-expanded')]);
  const beforeFolds = folds();
  const before = app.calls.length;

  if (kind === "todos") {
    const items = await app.rpc("todo.list", null);
    const changed = {...items.find(item => item.id === 1)!, title:"Accepted rename", updated_at:now - 300000};
    const made = {...changed, id:99, title:"Accepted new item"};
    app.handlers["todo.list"] = () => [...items.filter(item => item.id !== 1), changed, made];
    emit({actor:USER, name:"todo.updated", data:changed});
    emit({actor:USER, name:"todo.created", data:made});
  } else {
    const items = await app.rpc("pad.list", null);
    const changed = {...items.find(item => item.name === "a-pad-with-a-very-long-name-here")!, name:"Accepted rename", updated_at:now - 300000};
    const made = {...changed, name:"Accepted new item", incarnation:"new-identity"};
    app.handlers["pad.list"] = () => [...items.filter(item => item.incarnation !== changed.incarnation), changed, made];
    emit({actor:USER, name:"pad.changed", data:{name:changed.name}});
    emit({actor:USER, name:"pad.changed", data:{name:made.name}});
  }

  const renamed = await screen.findByText("Accepted rename");
  const created = await screen.findByText("Accepted new item");
  expect(renamed.closest('.shelf-row')?.querySelector('.item-age')?.textContent).toBe(expectedAge);
  expect(created.closest('.shelf-row')?.querySelector('.item-age')?.textContent).toBe(expectedAge);
  expect(existing.getAttribute("data-selected")).toBe(selected);
  expect(document.activeElement).toBe(nameButton);
  expect(folds()).toEqual(beforeFolds);
  expect(document.querySelector('.drawer[data-open=true]')).toBeNull();
  expect(app.calls.slice(before).filter(call => !['todo.list','todo.listHanded','pad.list'].includes(call.method))).toEqual([]);
});

it.each([{expectedAge:"5m"}])("u4709a_rows_use_updated_at_after_pending_todo_is_filed", async ({expectedAge}) => {
  const {todos, store} = await mountTodos([todo(1)], true, [], false, undefined, () => 600000);
  const hide = todos.show(todo(-1, {title:"Pending age"}));
  await screen.findByText("Pending age");
  expect(document.querySelector('[data-pending=true] .item-age')).toBeNull();
  store.todos = [...store.todos, todo(99, {title:"Pending age", updated_at:300000})];
  await todos.reload();
  hide();
  flush();
  expect(document.querySelector('[data-todo="99"] .item-age')?.textContent).toBe(expectedAge);
});
