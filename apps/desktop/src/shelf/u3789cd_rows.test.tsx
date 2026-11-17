import { copy } from "./copy";
import { open, target } from "./u3789RowsHarness";
import { settled } from "../rail/railFixture";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { notices } from "../testing/notices";
import { rpcCalls } from "../testing/appFixture";

afterEach(() => cleanup());

it.each([copy.todos, copy.pads])("u3789c_empty_groups_are_absent_%s", async tab => {
  await open("empty-project");

  if (tab === copy.pads) fireEvent.click(document.querySelector('#shelf-tab-pads')!);

  const panel = await waitFor(() => { const panel = document.querySelector<HTMLElement>(tab === copy.todos ? ".todos-tab" : ".pads-tab");

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
  flush();
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

it.each(["pointer", "key"])("u3789d_controls_keep_all_actions_%s", async input => {
  const { app, row } = await target("agent");

  const menu = () => {
    if (input === "pointer") fireEvent.contextMenu(row);
    else { row.focus(); fireEvent.keyDown(row, { key: "ContextMenu" }); }

    flush();
  };

  menu();
  await app.pickMenu(copy.openFolder);
  expect(app.openedTargets).toHaveLength(1);
  expect(document.querySelector('.rail-row[data-selected]')?.getAttribute('data-id')).toBe("tokens");
  menu();
  expect(app.menuLabels()).toEqual(expect.arrayContaining([copy.stop, copy.rename, copy.openInEditor, copy.remove]));
  expect(rpcCalls(app, "agent.stop")).toEqual([]);
  expect(rpcCalls(app, "rail.remove")).toEqual([]);
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
  const group = kind === "pad" ? '[data-shelf-group="auth"]' : '[data-shelf-group]';
  await waitFor(() => expect(panel().querySelectorAll(group)).toHaveLength(1));

  if ("id" in item) {
    if (action === "delete") await app.rpc("todo.delete", {operation: crypto.randomUUID(), ids:[item.id]});
    else await app.rpc("todo.move", {id:item.id, home:null});
  } else {
    if (action === "delete") await app.rpc("pad.delete", {name:item.name, operation: crypto.randomUUID()});
    else await app.rpc("pad.move", {name:item.name, home:null});
  }

  await waitFor(() => expect(panel().querySelectorAll(group)).toHaveLength(0));

  if (kind === "todo") expect(panel().querySelectorAll('.empty-state')).toHaveLength(1);
  else {
    expect(panel().querySelector('[data-pad="pad-0"]')).not.toBeNull();
    expect(panel().querySelector('[data-pad="only item"]')?.closest('[data-shelf-group]')?.getAttribute('data-shelf-group')).toBe(action === "move" ? "unassigned" : undefined);
  }
});

it("u3789d_controls_keep_native_attention_destination_return", async () => {
  const {app, emulators} = await open();
  const row = document.querySelector<HTMLElement>('.rail-row[data-id="backend"]')!;
  fireEvent.click(row);
  await settled();

  row.focus();
  fireEvent.keyDown(row, {key:"Enter"});
  await waitFor(() => expect(emulators.made.get("t-migrate")?.host?.contains(document.activeElement)).toBe(true));
  expect(document.querySelector('.rail-row[data-selected]')?.getAttribute('data-id')).toBe("migrate");
  expect(app.calls.filter(call => ["agent.spawn","agent.resume","rail.startDoor"].includes(call.method))).toEqual([]);
});

it("u3789d_controls_keep_all_actions_dismisses_failure_from_menu", async () => {
  const { app, row } = await target("todo-shelf");
  const frame = row.closest('.shelf-row')!;
  const tick = frame.querySelector<HTMLInputElement>('.todo-tick')!;
  tick.focus();
  app.handlers["todo.complete"] = () => { throw new RpcError(-32003, "completion refused"); };

  fireEvent.click(tick);
  await screen.findByText("completion refused");
  expect(tick.checked).toBe(false);
  fireEvent.contextMenu(row);
  await app.pickMenu(copy.dismissFailure);
  expect(frame.querySelector('[role=alert]')).toBeNull();
  expect(rpcCalls(app, "todo.complete")).toEqual([{ id: 1 }]);
});

it("u3789d_failed_rail_rename_keeps_retry_after_selection_changes", async () => {
  const { app, row, emulators } = await target("agent");
  const refused = new RpcError(-32003, "name already taken");
  app.handlers["rail.rename"] = () => { throw refused; };

  fireEvent.keyDown(row, { key: "F2" });
  const field = await screen.findByRole<HTMLInputElement>("textbox", { name: copy.name });
  const text = "  exact 日本語 🌱  ";
  fireEvent.input(field, { target: { value: text } });
  flush();
  fireEvent.keyDown(field, { key: "Enter" });
  await screen.findByRole("alert", { name: new RegExp(refused.message) });
  const elsewhere = document.querySelector<HTMLElement>('.rail-row[data-id="agent-4"]')!;
  fireEvent.blur(field);
  flush();
  // A press focuses the row before its click selects it.
  elsewhere.focus();
  fireEvent.click(elsewhere);
  await waitFor(() => expect(emulators.made.get("t-agent-4")?.host?.contains(document.activeElement)).toBe(true));
  expect(screen.getByRole("alert", { name: new RegExp(refused.message) })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: copy.retry }));
  const recovered = await screen.findByRole<HTMLInputElement>("textbox", { name: copy.name });
  await waitFor(() => expect(document.activeElement).toBe(recovered));
  expect(recovered.value).toBe(text);
  expect(rpcCalls(app, "rail.rename")).toEqual([{ id: "tokens", name: "exact 日本語 🌱" }]);
  fireEvent.click(screen.getByRole("button", { name: copy.dismissFailure }));
  flush();
  expect(notices("alert")).toEqual([]);
});
