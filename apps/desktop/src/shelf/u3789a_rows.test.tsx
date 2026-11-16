import { copy } from "./copy";
import { open, target, cases } from "./u3789RowsHarness";
import { settled } from "../rail/railFixture";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { RequestedApp as App } from "../testing/requestedApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { showEverythingInApp } from "../testing/showEverything";
import { createProjectDrafts } from "../state/connectedProject";
import { gate, rpcCalls } from "../testing/appFixture";

afterEach(() => cleanup());

it.each(["todo-shelf", "pad-shelf"] as const)("u3789a_click_selects_without_opening_%s", async kind => {
  const { app, row } = await target(kind);
  const start = app.calls.length;
  const frame = row.closest(".shelf-row, .pad-row-head, .rail-row")!;
  fireEvent.click(frame);
  fireEvent.click(row);
  await waitFor(() => expect(document.activeElement).toBe(row));
  expect(document.querySelector('.drawer[data-open="true"], .bubble:not([hidden])')).toBeNull();
  expect(app.calls.slice(start).filter(call => ["pad.read", "todo.getHistory", "todo.readHistory", "agent.spawn", "agent.resume", "todo.move", "pad.move", "todo.assign", "pad.setOwner"].includes(call.method))).toEqual([]);
});

it("u3789a_return_and_open_activate_once_todo_shelf", async () => {
  const { app, row } = await target("todo-shelf");
  const arrow = row.closest('.shelf-row')!.querySelector<HTMLButtonElement>('.todo-open')!;
  expect(arrow).not.toBeNull();
  fireEvent.click(arrow);
  await waitFor(() => expect(rpcCalls(app, "todo.getHistory")).toEqual([{ id: 1 }]));
  expect(document.querySelector('.drawer[data-open="true"]')).not.toBeNull();
  expect(rpcCalls(app, "todo.complete")).toEqual([]);
  expect(rpcCalls(app, "todo.update")).toEqual([]);
});

it.each(cases)("u3789a_return_activates_once_%s", async kind => {
  const { app, row } = await target(kind);

  row.focus(); fireEvent.keyDown(row, { key: "Enter", code: "Enter" });

  if (kind === "workstream" || kind === "agent") {
    await waitFor(() => expect(document.activeElement?.closest('.pane-screen')).not.toBeNull());
  } else {
    const method = kind.startsWith("pad") ? "pad.read" : "todo.getHistory";
    const identity = kind.startsWith("todo") ? { id: 1 } : { name: kind === "pad-shelf" ? "a-pad-with-a-very-long-name-here" : "pad-0" };
    await waitFor(() => expect(rpcCalls(app, method)).toEqual([identity]));
    expect(document.querySelector('.drawer[data-open="true"]')).not.toBeNull();
  }

  expect(rpcCalls(app, "agent.spawn")).toEqual([]);
  expect(rpcCalls(app, "agent.resume")).toEqual([]);
});

it.each(["todo-shelf", "pad-shelf", "workstream", "agent"] as const)("u3789a_rename_never_opens_%s", async kind => {
  // The rename and its cleanup need only the target row and its ancestors.
  const { app, row } = await target(kind, kind === "agent" ? ["backend", "auth", "tokens"] : ["payments"]);
  const start = app.calls.length;
  fireEvent.click(row);
  await settled();
  fireEvent.click(row);
  await settled();

  // U3789f: a double-click on a Todo or Pad row opens it; F2 renames.
  if (kind === "todo-shelf" || kind === "pad-shelf") {
    row.focus();
    fireEvent.keyDown(row, { key: "F2" });
  } else fireEvent.dblClick(row);
  const field = await screen.findByRole<HTMLInputElement>("textbox", { name: copy.name });
  await waitFor(() => expect(document.activeElement).toBe(field));
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(field.value.length);
  fireEvent.input(field, { target: { value: "renamed row" } });
  flush();

  // The row editor loads the original History version without acknowledging a read.
  if (kind.startsWith("todo")) await waitFor(() => expect(rpcCalls(app, "todo.getHistory")).toHaveLength(1));
  fireEvent.keyDown(field, { key: "Enter" });
  const method = kind.startsWith("todo") ? "todo.update" : kind === "pad-shelf" ? "pad.rename" : "rail.rename";
  await waitFor(() => expect(rpcCalls(app, method)).toHaveLength(1));
  expect(app.calls.slice(start).filter(call => ["pad.read", "todo.readHistory", "agent.spawn", "agent.resume", "todo.move", "pad.move", "todo.assign", "pad.setOwner"].includes(call.method))).toEqual([]);
  expect(document.querySelector('.drawer[data-open="true"]')).toBeNull();
  expect(rpcCalls(app, "pad.delete")).toEqual([]);
});

it("u3789a_open_never_starts_a_stopped_door", async () => {
  const { app } = await open("door-stopped");
  const row = document.querySelector<HTMLElement>(".rail-row")!;
  fireEvent.click(row);
  await settled();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  await settled();
  expect(app.calls.filter(call => ["rail.startDoor", "agent.spawn", "agent.resume", "todo.move", "pad.move", "todo.assign", "pad.setOwner"].includes(call.method))).toEqual([]);
});

it.each(["todo-shelf", "pad-shelf"] as const)("u3789a_rename_never_opens_escape_and_f2_%s", async kind => {
  const { app, row } = await target(kind);
  row.focus();
  fireEvent.keyDown(row, { key: "F2" });
  const field = await screen.findByRole<HTMLInputElement>("textbox", { name: copy.name });
  const identity = row.closest("[data-todo], [data-incarnation]");
  // Solid 2 rewrites an input's `value` on each spread update: typing waits for the field's load to land.
  await waitFor(() => expect(field.getAttribute("aria-busy")).toBe("false"));
  const text = "  unfinished 日本語 🌱  ";
  fireEvent.input(field, { target: { value: text } });
  flush();
  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(document.activeElement?.closest("[data-todo], [data-incarnation]")).toBe(identity));
  fireEvent.keyDown(document.activeElement!, { key: "F2" });
  expect((await screen.findByRole<HTMLInputElement>("textbox", { name: copy.name })).value).toBe(text);
  expect(app.calls.filter(call => ["todo.update", "pad.rename", "pad.read", "todo.readHistory"].includes(call.method))).toEqual([]);
});

it.each(["todo-shelf", "pad-shelf"] as const)("u3789a_rename_never_opens_reload_keeps_original_identity_%s", async kind => {
  // CI exceeded 15 s remounting two full trees; draft identity needs only its item's Home.
  const controls = await target(kind, ["payments"]);
  controls.row.focus();
  fireEvent.keyDown(controls.row, {key:"F2", code:"F2"});
  const field = await screen.findByRole<HTMLInputElement>("textbox", {name:copy.name});
  await waitFor(() => expect(field.getAttribute("aria-busy")).toBe("false"));
  await waitFor(() => expect(document.activeElement).toBe(field));
  const text = "  composed 日本語 🌱  ";
  fireEvent.input(field, {target:{value:text}});
  flush();
  field.setSelectionRange(2, 5);
  fireEvent.select(field);
  const project = (await controls.app.projects())[0]!;

  await waitFor(() => expect(JSON.parse(localStorage.getItem(`roundup:drafts:${project.path}`)!).drafts.find((draft: { value: { text?: string } }) => draft.value.text === text)?.selection).toMatchObject({ start: 2, end: 5 }));
  controls.view.unmount();
  render(() => <App app={controls.app} drafts={createProjectDrafts()} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  await showEverythingInApp(undefined, kind === "pad-shelf" ? copy.pads : copy.todos);

  const selector = kind === "todo-shelf" ? '.todos-tab [data-todo="1"] .todo-row-button' : '.pads-tab [data-incarnation="fixture-1"] .pad-name';

  const row = await waitFor(() => {const row = document.querySelector<HTMLElement>(selector);

 if (!row) throw new Error("row unavailable");

 return row;});

  row.focus();
  fireEvent.keyDown(row, {key:"F2", code:"F2"});

  const restored = await screen.findByRole<HTMLInputElement>("textbox", {name:copy.name});
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
  row.focus();
  fireEvent.keyDown(row, {key:"F2", code:"F2"});
  const field = await screen.findByRole<HTMLInputElement>("textbox", {name:copy.name});
  await waitFor(() => expect(field.getAttribute("aria-busy")).toBe("false"));
  fireEvent.input(field, {target:{value:"first revision"}});
  flush();
  fireEvent.keyDown(field, {key:"Enter"});
  await waitFor(() => expect(rpcCalls(app, method)).toHaveLength(1));
  const next = "  next 日本語 🌱  ";
  fireEvent.input(field, {target:{value:next}});
  flush();
  reply.reject(new RpcError(-32003, "rename refused"));
  await screen.findByText("rename refused");
  expect(field.value).toBe(next);
  const saved = drafts("/Users/you/harness").list().filter(draft => draft.destination.surface === "row-name");
  expect(saved.map(draft => draft.value.text)).toEqual(["first revision", next]);
  expect(new Set(saved.map(draft => draft.destination.object))).toEqual(new Set([kind === "todo-shelf" ? "todo:1" : "pad:fixture-1"]));
  fireEvent.keyDown(field, {key:"Escape"});
  await waitFor(() => expect(document.activeElement?.matches("button")).toBe(true));
  fireEvent.keyDown(document.activeElement!, {key:"F2"});
  expect((await screen.findByRole<HTMLInputElement>("textbox", {name:copy.name})).value).toBe(next);
  expect(rpcCalls(app, method)).toHaveLength(1);
});

it.each(["todo-shelf", "pad-shelf"] as const)("u3789a_rename_navigation_keeps_draft_and_chosen_focus_%s", async kind => {
  const { row, drafts, app } = await target(kind);
  row.focus();
  fireEvent.keyDown(row, { key: "F2" });
  const field = await screen.findByRole<HTMLInputElement>("textbox", { name: copy.name });
  await waitFor(() => expect(field.getAttribute("aria-busy")).toBe("false"));
  const text = "  leave e\u0301 日本語 🌱  ";
  fireEvent.input(field, { target: { value: text } });
  flush();
  const next = document.querySelector<HTMLElement>('.rail-row[data-id="tokens"]')!;
  next.focus();
  await settled();
  expect(document.activeElement).toBe(next);
  expect(drafts("/Users/you/harness").list().findLast(draft => draft.destination.surface === "row-name")?.value.text).toBe(text);
  expect(app.calls.filter(call => ["todo.update", "pad.rename", "todo.readHistory", "pad.read"].includes(call.method))).toEqual([]);
});
