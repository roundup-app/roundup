import { open } from "./u3789RowsHarness";
import { settled } from "../rail/railFixture";
import type { CreateParams } from "@contracts/todo/CreateParams";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { gate, rpcCalls } from "../testing/appFixture";

afterEach(() => cleanup());

it.each(["key", "scope"])("u3789b_one_action_focuses_add_%s", async input => {
  const { app } = await open();
  const disclosure = document.querySelector<HTMLElement>('.todos-tab [data-shelf-group="unassigned"] .shelf-group-control')!;
  fireEvent.click(disclosure);
  await waitFor(() => expect(disclosure.getAttribute("aria-expanded")).toBe("false"));
  const folded = disclosure.getAttribute("aria-expanded");

  if (input === "key") { disclosure.focus(); fireEvent.keyDown(disclosure, { key: "n", code: "KeyN" }); }
  else fireEvent.click(document.querySelector('.shelf-add')!);
  const field = await screen.findByRole<HTMLInputElement>("textbox", { name: /new todo/i });
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.input(field, { target: { value: "new exact title" } });
  flush();
  expect(disclosure.getAttribute("aria-expanded")).toBe(folded);
  expect(rpcCalls(app, "todo.create")).toEqual([]);
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(rpcCalls(app, "todo.create")).toHaveLength(1));
  expect(disclosure.getAttribute("aria-expanded")).toBe(folded);
  expect(rpcCalls(app, "todo.create")[0]).toMatchObject({ title: "new exact title" });
});

it("u3789b_cancel_empty_and_failure_keep_input", async () => {
  const { app } = await open();
  fireEvent.click(document.querySelector('.shelf-add')!);
  const field = await screen.findByRole<HTMLInputElement>("textbox", { name: /new todo/i });
  app.handlers["todo.create"] = () => { throw new Error("creation refused"); };

  const text = "  日本語 🌱 exact  ";
  fireEvent.input(field, { target: { value: text } });
  flush();
  fireEvent.keyDown(field, { key: "n", code: "KeyN" });
  fireEvent.keyDown(field, { key: "Enter" });
  await screen.findByText("creation refused");
  expect(field.value).toBe(text);
  expect(rpcCalls(app, "todo.create")).toHaveLength(1);
  fireEvent.keyDown(field, { key: "Escape" });
  flush();
  fireEvent.click(document.querySelector('.shelf-add')!);
  expect((await screen.findByRole<HTMLInputElement>("textbox", { name: /new todo/i })).value).toBe(text);
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
  const folds = () => [...panel.querySelectorAll('[data-shelf-group]')].map(group => [group.getAttribute('data-shelf-group'), group.querySelector(':scope > .shelf-group-head .shelf-group-control')?.getAttribute('aria-expanded')]);
  const before = folds();

  if (input === "key") {
    const focus = panel.querySelector<HTMLElement>('.todo-row-button, .shelf-group-control');

    if (focus) { focus.focus(); fireEvent.keyDown(focus, {key:"n", code:"KeyN"}); }
    else { panel.focus(); fireEvent.keyDown(panel, {key:"n", code:"KeyN"}); }
  }
  else fireEvent.click(document.querySelector('.shelf-add')!);
  const field = await screen.findByRole<HTMLInputElement>("textbox", {name:/new todo/i});
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.input(field, {target:{value:"scoped exact"}});
  flush();
  fireEvent.keyDown(field, {key:"Enter"});
  await waitFor(() => expect(rpcCalls(app, "todo.create")).toHaveLength(1));
  const expected: CreateParams = { title: "scoped exact", body: null, blockers: null };

  if (scope === "agent") expected.owner = { kind: "agent", id: "tokens", parent: null };

  expect(rpcCalls(app, "todo.create")[0]).toEqual(expected);

  if (scope !== "overview") await waitFor(() => expect(rpcCalls(app, "todo.move")).toEqual([{id:expect.any(Number), home:scope === "agent" ? "auth" : "payments"}]));
  else expect(rpcCalls(app, "todo.move")).toEqual([]);
  expect(folds().filter(([id]) => before.some(([existing]) => existing === id))).toEqual(before);
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
  flush();
  fireEvent.keyDown(field, {key:"Enter"});
  await waitFor(() => expect(rpcCalls(app,"todo.create")).toHaveLength(1));
  fireEvent.input(field, {target:{value:newer}});
  flush();
  fireEvent.click(document.querySelector('.rail-row[data-id="payments"]')!);
  flush();
  reply.reject(new Error("creation refused"));
  await screen.findByText("creation refused");
  expect(field.value).toBe(newer);
  const saved = drafts("/Users/you/harness").list().filter(draft => draft.destination.surface === "todos" && draft.destination.object === "new");
  expect(saved.map(draft => draft.value.title)).toEqual([original,newer]);
  expect(saved.every(draft => draft.destination.recipient === "auth" && draft.value.home === "auth" && draft.value.owner === "tokens")).toBe(true);
  expect(rpcCalls(app,"todo.create")[0]).toEqual({title:original.trim(),body:null,blockers:null,owner:{kind:"agent",id:"tokens",parent:null}});
  expect(rpcCalls(app,"todo.move")).toEqual([]);
});
