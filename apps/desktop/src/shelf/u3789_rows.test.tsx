import { settled } from "../rail/railFixture";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import type { SeedName } from "../testing/seeds";
import { seedApp } from "../testing/seeds";
import { showEverythingInApp } from "../testing/showEverything";
import { createProjectDrafts } from "../state/connectedProject";
import { gate, rpcCalls } from "../testing/appFixture";

const open = async (seed: SeedName = "tree-40") => {
  const controls = seedApp(seed, 0);
  const drafts = createProjectDrafts();
  const emulators = fakeEmulators();
  const view = render(() => <App app={controls.app} drafts={drafts} reducedMotion={() => true} clock={() => 0} createEmulator={emulators.factory} />);
  await showEverythingInApp();

  return { ...controls, view, drafts, emulators };
};

const cases = ["todo-shelf", "pad-shelf", "todo-owned", "pad-owned", "workstream", "agent"] as const;

type RowCase = typeof cases[number];

const target = async (kind: RowCase) => {
  const controls = await open();

  if (kind === "pad-shelf") fireEvent.click(document.querySelector('#shelf-tab-pads')!);

  if (kind === "todo-owned" || kind === "pad-owned") {
    const id = kind === "todo-owned" ? "tokens" : "agent-1";
    fireEvent.click(document.querySelector(`.rail-row[data-id="${id}"] [data-pads-control]`)!);
  }

  const selector = {
    "todo-shelf": '.todos-tab [data-todo="1"] .todo-row-button',
    "pad-shelf": '.pads-tab [data-pad="a-pad-with-a-very-long-name-here"] .pad-name',
    "todo-owned": '.rail-leaf [data-todo="1"] .todo-row-button',
    "pad-owned": '.rail-leaf [data-incarnation="fixture-0"] .rail-pad',
    workstream: '.rail-row[data-id="payments"]',
    agent: '.rail-row[data-id="tokens"]',
  }[kind];

  await waitFor(() => expect(document.querySelector(selector)).not.toBeNull());

  return { ...controls, row: document.querySelector<HTMLElement>(selector)! };
};

it.each(cases)("u3789a_click_selects_without_opening_%s", async kind => {
  const { app, row } = await target(kind);
  const start = app.calls.length;
  const frame = row.closest(".shelf-row, .pad-row-head, .rail-row")!;
  fireEvent.click(frame);
  fireEvent.click(row);
  await waitFor(() => expect(document.activeElement).toBe(row));
  expect(document.querySelector('.drawer[data-open="true"], .bubble:not([hidden])')).toBeNull();
  expect(app.calls.slice(start).filter(call => ["pad.read", "todo.getHistory", "todo.readHistory", "agent.spawn", "agent.resume", "todo.move", "pad.move", "todo.assign", "pad.setOwner"].includes(call.method))).toEqual([]);
});

it.each(cases.flatMap(kind => ["return", "open"].map(input => ({ kind, input, name: `${kind}-${input}` }))))("u3789a_return_and_open_activate_once_$name", async ({ kind, input }) => {
  const { app, row } = await target(kind);

  if (input === "return") { row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" }); }
  else fireEvent.click(row.closest('.shelf-row, .rail-row, .pad-row-head')!.querySelector<HTMLButtonElement>('[aria-label="Open"]')!);

  if (kind === "workstream" || kind === "agent") {
    await waitFor(() => expect(document.activeElement?.closest('.pane-screen')).not.toBeNull());
  } else {
    const method = kind.startsWith("pad") ? "pad.read" : "todo.getHistory";
    await waitFor(() => expect(rpcCalls(app, method)).toHaveLength(1));
    expect(document.querySelector('.drawer[data-open="true"]')).not.toBeNull();
  }

  expect(rpcCalls(app, "agent.spawn")).toEqual([]);
  expect(rpcCalls(app, "agent.resume")).toEqual([]);
});

it.each(["todo-shelf", "pad-shelf", "todo-owned", "workstream", "agent"] as const)("u3789a_rename_never_opens_%s", async kind => {
  const { app, row } = await target(kind);
  const start = app.calls.length;
  fireEvent.click(row);
  await settled();
  fireEvent.click(row);
  await settled();
  fireEvent.dblClick(row);
  const field = await screen.findByRole<HTMLInputElement>("textbox", { name: "Name" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(field.value.length);
  fireEvent.input(field, { target: { value: "renamed row" } });

  // The row editor loads the original History version without acknowledging a read.
  if (kind.startsWith("todo")) await waitFor(() => expect(rpcCalls(app, "todo.getHistory")).toHaveLength(1));
  fireEvent.keyDown(field, { key: "Enter" });
  const method = kind.startsWith("todo") ? "todo.update" : kind === "pad-shelf" ? "pad.rename" : "rail.rename";
  await waitFor(() => expect(rpcCalls(app, method)).toHaveLength(1));
  expect(app.calls.slice(start).filter(call => ["pad.read", "todo.readHistory", "agent.spawn", "agent.resume", "todo.move", "pad.move", "todo.assign", "pad.setOwner"].includes(call.method))).toEqual([]);
  expect(document.querySelector('.drawer[data-open="true"]')).toBeNull();
  expect(rpcCalls(app, "pad.delete")).toEqual([]);
});

it("u3789a_readonly_pad_keeps_ownership_before_rename", async () => {
  const { app, row } = await target("pad-owned");
  row.focus();
  fireEvent.keyDown(row, { key: "F2" });
  await screen.findByText("Make this Pad yours before renaming.");
  expect(document.querySelector('.drawer[data-open="true"]')).toBeNull();
  expect(rpcCalls(app, "pad.rename")).toEqual([]);
  expect(rpcCalls(app, "pad.setOwner")).toEqual([]);
});

it.each(["key", "scope"])("u3789b_one_action_focuses_add_%s", async input => {
  const { app } = await open();
  const group = document.querySelector<HTMLElement>('.todos-tab [data-shelf-group="unassigned"]')!;
  const disclosure = group.querySelector<HTMLElement>('[data-part="branch-control"]')!;
  fireEvent.click(disclosure);
  await waitFor(() => expect(group.getAttribute("aria-expanded")).toBe("false"));
  const folded = group.getAttribute("aria-expanded");

  if (input === "key") { disclosure.focus(); fireEvent.keyDown(disclosure, { key: "n", code: "KeyN" }); }
  else fireEvent.click(document.querySelector('.shelf-add')!);
  const field = await screen.findByRole<HTMLInputElement>("textbox", { name: /new todo/i });
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.input(field, { target: { value: "new exact title" } });
  expect(group.getAttribute("aria-expanded")).toBe(folded);
  expect(rpcCalls(app, "todo.create")).toEqual([]);
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(rpcCalls(app, "todo.create")).toHaveLength(1));
  expect(group.getAttribute("aria-expanded")).toBe(folded);
  expect(rpcCalls(app, "todo.create")[0]).toMatchObject({ title: "new exact title" });
});

it("u3789b_cancel_empty_and_failure_keep_input", async () => {
  const { app } = await open();
  fireEvent.click(document.querySelector('.shelf-add')!);
  const field = await screen.findByRole<HTMLInputElement>("textbox", { name: /new todo/i });
  app.handlers["todo.create"] = () => { throw new Error("creation refused"); };

  const text = "  日本語 🌱 exact  ";
  fireEvent.input(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: "n", code: "KeyN" });
  fireEvent.keyDown(field, { key: "Enter" });
  await screen.findByText("creation refused");
  expect(field.value).toBe(text);
  expect(rpcCalls(app, "todo.create")).toHaveLength(1);
  fireEvent.keyDown(field, { key: "Escape" });
  fireEvent.click(document.querySelector('.shelf-add')!);
  expect((await screen.findByRole<HTMLInputElement>("textbox", { name: /new todo/i })).value).toBe(text);
});

it("u3789a_open_never_starts_a_stopped_door", async () => {
  const { app } = await open("door-stopped");
  const row = document.querySelector<HTMLElement>(".rail-row")!;
  fireEvent.click(row);
  await settled();
  fireEvent.click(row.querySelector('[aria-label="Open"]')!);
  expect(app.calls.filter(call => ["rail.startDoor", "agent.spawn", "agent.resume", "todo.move", "pad.move", "todo.assign", "pad.setOwner"].includes(call.method))).toEqual([]);
});

it.each(["Todos", "Pads"])("u3789c_empty_groups_are_absent_%s", async tab => {
  await open("empty-project");

  if (tab === "Pads") fireEvent.click(document.querySelector('#shelf-tab-pads')!);

  const panel = await waitFor(() => { const panel = document.querySelector<HTMLElement>(tab === "Todos" ? ".todos-tab" : ".pads-tab");

 if (!panel) throw new Error("tab not mounted");

 return panel; });

  await waitFor(() => expect(panel.querySelector(".empty-state")).not.toBeNull());
  expect(panel.querySelectorAll('[data-shelf-group]')).toHaveLength(0);
  expect(panel.querySelectorAll('.empty-state')).toHaveLength(1);
});

it("u3789c_one_empty_line_or_add_field", async () => {
  const { app } = await open("empty-project");
  fireEvent.click(document.querySelector('.shelf-add')!);
  const field = await screen.findByRole("textbox", { name: /new todo/i });
  expect(document.querySelector('.todos-tab .empty-state')).toBeNull();
  expect(document.querySelectorAll('.todos-tab [data-shelf-group]')).toHaveLength(0);
  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(document.querySelector('.todos-tab .empty-state')).not.toBeNull());
  expect(rpcCalls(app, "todo.create")).toEqual([]);
  fireEvent.click(document.querySelector('.shelf-add')!);
  const again = await screen.findByRole("textbox", {name:/new todo/i});
  fireEvent.input(again, {target:{value:"first item"}});
  fireEvent.keyDown(again, {key:"Enter"});
  await waitFor(() => expect(document.querySelectorAll('.todos-tab [data-shelf-group]')).toHaveLength(1));
  expect(document.querySelector('.todos-tab .empty-state')).toBeNull();
  const [made] = await app.rpc("todo.list", null);
  await app.rpc("todo.complete", {id:made!.id});
  fireEvent.keyDown(again, {key:"Escape"});
  const done = await screen.findByRole("button", {name:"1 done"});
  expect(document.querySelector('.todos-tab .empty-state')).toBeNull();
  fireEvent.click(done);
  const row = await screen.findByRole("button", {name:/Done #.*first item/});
  row.focus();
  fireEvent.keyDown(row, {key:"Enter"});
  await waitFor(() => expect(rpcCalls(app,"todo.getHistory")).toHaveLength(1));
});

it.each(["todo-shelf", "pad-shelf"] as const)("u3789a_rename_never_opens_escape_and_f2_%s", async kind => {
  const { app, row } = await target(kind);
  row.focus();
  fireEvent.keyDown(row, { key: "F2" });
  const field = await screen.findByRole<HTMLInputElement>("textbox", { name: "Name" });
  const identity = row.closest("[data-todo], [data-incarnation]");
  const text = "  unfinished 日本語 🌱  ";
  fireEvent.input(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(document.activeElement?.closest("[data-todo], [data-incarnation]")).toBe(identity));
  fireEvent.keyDown(document.activeElement!, { key: "F2" });
  expect((await screen.findByRole<HTMLInputElement>("textbox", { name: "Name" })).value).toBe(text);
  expect(app.calls.filter(call => ["todo.update", "pad.rename", "pad.read", "todo.readHistory"].includes(call.method))).toEqual([]);
});

it("u3789d_controls_keep_all_actions", async () => {
  const { app, row } = await target("agent");
  const selected = document.querySelector('.rail-row[data-selected="true"]')?.getAttribute('data-id');
  fireEvent.contextMenu(row);
  await app.pickMenu("Open folder");
  expect(app.openedTargets).toHaveLength(1);
  expect(document.querySelector('.rail-row[data-selected="true"]')?.getAttribute('data-id')).toBe(selected);
  fireEvent.contextMenu(row);
  expect(app.menuLabels()).toEqual(expect.arrayContaining(["Stop", "Rename", "Open in editor", "Remove"]));
  expect(rpcCalls(app, "agent.stop")).toEqual([]);
  expect(rpcCalls(app, "rail.remove")).toEqual([]);
});


it.each(["overview", "workstream", "agent", "terminal"].flatMap(scope => ["key", "scope"].map(input => ({scope, input}))))("u3789b_one_action_focuses_add_$scope/$input", async ({scope, input}) => {
  const { app } = await open();

  if (scope !== "overview") {
    fireEvent.click(document.querySelector(`.rail-row[data-id="${scope === "agent" ? "tokens" : "payments"}"]`)!);
    await settled();
  }

  if (scope === "terminal") {
    fireEvent.click(document.querySelector('.terminal-new')!);
    await waitFor(() => expect(rpcCalls(app, "terminal.open")).toHaveLength(1));
  }

  const panel = document.querySelector<HTMLElement>('.todos-tab')!;
  const folds = () => [...panel.querySelectorAll('[data-shelf-group]')].map(group => [group.getAttribute('data-shelf-group'), group.getAttribute('aria-expanded')]);
  const before = folds();

  if (input === "key") {
    const focus = panel.querySelector<HTMLElement>('.todo-row-button, [data-part=branch-control]');

    if (focus) { focus.focus(); fireEvent.keyDown(focus, {key:"n", code:"KeyN"}); }
    else { panel.focus(); fireEvent.keyDown(panel, {key:"n", code:"KeyN"}); }
  }
  else fireEvent.click(document.querySelector('.shelf-add')!);
  const field = await screen.findByRole<HTMLInputElement>("textbox", {name:/new todo/i});
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.input(field, {target:{value:"scoped exact"}});
  fireEvent.keyDown(field, {key:"Enter"});
  await waitFor(() => expect(rpcCalls(app, "todo.create")).toHaveLength(1));
  const expected: {title:string;body:null;blockers:null;owner?:{kind:"agent";id:string;parent:null}} = {title:"scoped exact",body:null,blockers:null};
  if (scope === "agent") expected.owner = {kind:"agent",id:"tokens",parent:null};
  expect(rpcCalls(app, "todo.create")[0]).toEqual(expected);

  if (scope !== "overview") await waitFor(() => expect(rpcCalls(app, "todo.move")).toEqual([{id:expect.any(Number), home:scope === "agent" ? "auth" : "payments"}]));
  else expect(rpcCalls(app, "todo.move")).toEqual([]);
  expect(folds().filter(([id]) => before.some(([existing]) => existing === id))).toEqual(before);
});

it.each(["todo-shelf", "pad-shelf"] as const)("u3789a_rename_never_opens_reload_keeps_original_identity_%s", async kind => {
  const controls = await target(kind);
  fireEvent.keyDown(controls.row, {key:"F2"});
  const field = await screen.findByRole<HTMLInputElement>("textbox", {name:"Name"});
  await waitFor(() => expect(field.getAttribute("aria-busy")).toBe("false"));
  const text = "  composed 日本語 🌱  ";
  fireEvent.input(field, {target:{value:text}});
  field.setSelectionRange(2, 5);
  fireEvent.select(field);
  controls.view.unmount();
  render(() => <App app={controls.app} drafts={createProjectDrafts()} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  await showEverythingInApp();

  if (kind === "pad-shelf") fireEvent.click(document.querySelector('#shelf-tab-pads')!);
  const selector = kind === "todo-shelf" ? '.todos-tab [data-todo="1"] .todo-row-button' : '.pads-tab [data-incarnation="fixture-1"] .pad-name';
  const row = await waitFor(() => {const row = document.querySelector<HTMLElement>(selector);

 if (!row) throw new Error("row unavailable");

 return row;});
  fireEvent.keyDown(row, {key:"F2"});
  const restored = await screen.findByRole<HTMLInputElement>("textbox", {name:"Name"});
  await waitFor(() => expect(document.activeElement).toBe(restored));
  expect(restored.value).toBe(text);
  expect([restored.selectionStart, restored.selectionEnd]).toEqual([2,5]);
  expect(controls.app.calls.filter(call => ["todo.update","pad.rename","pad.read","todo.readHistory"].includes(call.method))).toEqual([]);
});

it.each(["todo-shelf", "pad-shelf"] as const)("u3789a_rename_never_opens_older_failure_keeps_newer_text_%s", async kind => {
  const {app, row, drafts} = await target(kind);
  const method = kind === "todo-shelf" ? "todo.update" : "pad.rename";
  const reply = gate<never>();
  app.handlers[method] = () => reply.promise;
  fireEvent.keyDown(row, {key:"F2"});
  const field = await screen.findByRole<HTMLInputElement>("textbox", {name:"Name"});
  await waitFor(() => expect(field.getAttribute("aria-busy")).toBe("false"));
  fireEvent.input(field, {target:{value:"first revision"}});
  fireEvent.keyDown(field, {key:"Enter"});
  await waitFor(() => expect(rpcCalls(app, method)).toHaveLength(1));
  const next = "  next 日本語 🌱  ";
  fireEvent.input(field, {target:{value:next}});
  reply.reject(new Error("rename refused"));
  await screen.findByText("rename refused");
  expect(field.value).toBe(next);
  const saved = drafts("/Users/you/harness").list().filter(draft => draft.destination.surface === "row-name");
  expect(saved.map(draft => draft.value.text)).toEqual(["first revision", next]);
  expect(new Set(saved.map(draft => draft.destination.object))).toEqual(new Set([kind === "todo-shelf" ? "todo:1" : "pad:fixture-1"]));
  fireEvent.keyDown(field, {key:"Escape"});
  await waitFor(() => expect(document.activeElement?.matches("button")).toBe(true));
  fireEvent.keyDown(document.activeElement!, {key:"F2"});
  expect((await screen.findByRole<HTMLInputElement>("textbox", {name:"Name"})).value).toBe(next);
  expect(rpcCalls(app, method)).toHaveLength(1);
});


it("u3789b_return_files_once_without_unfolding_retains_original_target_and_newer_revision", async () => {
  const {app, drafts} = await open();
  fireEvent.click(document.querySelector('.rail-row[data-id="tokens"]')!);
  await settled();
  fireEvent.click(document.querySelector('.shelf-add')!);
  const field = await screen.findByRole<HTMLInputElement>("textbox", {name:/new todo/i});
  const reply = gate<never>();
  app.handlers["todo.create"] = () => reply.promise;
  const original = "  first 日本語 🌱  ";
  const newer = "  next e\u0301 🧪  ";
  fireEvent.input(field, {target:{value:original}});
  fireEvent.keyDown(field, {key:"Enter"});
  await waitFor(() => expect(rpcCalls(app,"todo.create")).toHaveLength(1));
  fireEvent.input(field, {target:{value:newer}});
  fireEvent.click(document.querySelector('.rail-row[data-id="payments"]')!);
  reply.reject(new Error("creation refused"));
  await screen.findByText("creation refused");
  expect(field.value).toBe(newer);
  const saved = drafts("/Users/you/harness").list().filter(draft => draft.destination.surface === "todos" && draft.destination.object === "new");
  expect(saved.map(draft => draft.value.title)).toEqual([original,newer]);
  expect(saved.every(draft => draft.destination.recipient === "auth" && draft.value.home === "auth" && draft.value.owner === "tokens")).toBe(true);
  expect(rpcCalls(app,"todo.create")[0]).toEqual({title:original.trim(),body:null,blockers:null,owner:{kind:"agent",id:"tokens",parent:null}});
  expect(rpcCalls(app,"todo.move")).toEqual([]);
});

it.each(["todo", "pad"].flatMap(kind => ["delete", "move"].map(action => ({kind,action}))))("u3789c_empty_groups_are_absent_after_last_$action/$kind", async ({kind,action}) => {
  const {app} = await open();
  const item = kind === "todo" ? await app.rpc("todo.create", {title:"only item",body:null,blockers:null}) : await app.rpc("pad.create", {name:"only item",text:null});

  if ("id" in item) await app.rpc("todo.move", {id:item.id, home:"auth"});
  else await app.rpc("pad.move", {name:item.name, home:"auth"});
  fireEvent.click(document.querySelector('.rail-row[data-id="auth"]')!);
  await settled();

  if (kind === "pad") fireEvent.click(document.querySelector('#shelf-tab-pads')!);
  const panel = () => document.querySelector(kind === "todo" ? '.todos-tab' : '.pads-tab')!;
  await waitFor(() => expect(panel().querySelectorAll('[data-shelf-group]')).toHaveLength(1));

  if ("id" in item) {
    if (action === "delete") await app.rpc("todo.delete", {id:item.id});
    else await app.rpc("todo.move", {id:item.id, home:null});
  } else {
    if (action === "delete") await app.rpc("pad.delete", {name:item.name});
    else await app.rpc("pad.move", {name:item.name, home:null});
  }

  await waitFor(() => expect(panel().querySelectorAll('[data-shelf-group]')).toHaveLength(0));
  expect(panel().querySelectorAll('.empty-state')).toHaveLength(1);
});


it.each(["return", "open"])("u3789d_controls_keep_native_attention_destination_%s", async input => {
  const {app, emulators} = await open();
  const row = document.querySelector<HTMLElement>('.rail-row[data-id="backend"]')!;
  fireEvent.click(row);
  await settled();

  if (input === "return") fireEvent.keyDown(row, {key:"Enter"});
  else fireEvent.click(row.querySelector('[aria-label="Open"]')!);
  await waitFor(() => expect(emulators.made.get("t-migrate")?.host?.contains(document.activeElement)).toBe(true));
  expect(document.querySelector('.rail-row[data-selected=true]')?.getAttribute('data-id')).toBe("migrate");
  expect(app.calls.filter(call => ["agent.spawn","agent.resume","rail.startDoor"].includes(call.method))).toEqual([]);
});
