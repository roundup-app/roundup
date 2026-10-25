import { settled } from "../rail/railFixture";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import type { SeedName } from "../testing/seeds";
import { seedApp } from "../testing/seeds";
import { showEverythingInApp } from "../testing/showEverything";
import { rpcCalls } from "../testing/appFixture";

const open = async (seed: SeedName = "tree-40") => {
  const controls = seedApp(seed, 0);
  render(() => <App app={controls.app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  await showEverythingInApp();

  return controls;
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
  fireEvent.click(row);
  fireEvent.click(row);
  await waitFor(() => expect(document.activeElement).toBe(row));
  expect(document.querySelector('.drawer[data-open="true"], .bubble:not([hidden])')).toBeNull();
  expect(app.calls.slice(start).filter(call => ["pad.read", "todo.getHistory", "todo.readHistory", "agent.spawn", "agent.resume"].includes(call.method))).toEqual([]);
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
  expect(app.calls.slice(start).filter(call => ["pad.read", "todo.readHistory", "agent.spawn", "agent.resume"].includes(call.method))).toEqual([]);
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
  expect(app.calls.filter(call => ["rail.startDoor", "agent.spawn", "agent.resume"].includes(call.method))).toEqual([]);
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
