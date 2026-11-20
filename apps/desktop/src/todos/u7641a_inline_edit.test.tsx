import { stubDialogLayout } from "../shelf/bulkQuestionHarness";
import { flush } from "solid-js";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";

const fail = (message: string): never => { throw new Error(message); };

import { historyLoaded, mountTodos, todo, todoCallsTo as callsTo } from "./testHarness";
import { AGENT, openShelf, padOf } from "../pads/padsFixture";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

stubDialogLayout();

const drawer = () => screen.getByRole("complementary", { name: "Drawer" });

const item = () => todo(5, { title: "session store", body: "Move the cache." });

const openDrawer = async () => {
  const mounted = await mountTodos([item()], true);
  const row = (await screen.findAllByRole("button", { name: /#5/ })).find(candidate => candidate.className !== "word") ?? fail("no row");
  row.focus();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  await within(drawer()).findByRole("region", { name: "Activity" });
  await historyLoaded(mounted.app);
  mounted.app.handlers["todo.update"] = () => item();

  return mounted;
};

const noSaveOrCancel = () => expect(screen.queryByRole("button", { name: /save|cancel/i })).toBeNull();

it("u7641a_double_click_renames_a_todo_and_a_pad_in_place", async () => {
  const { app } = await mountTodos([item()], true);
  const row = async () => (await screen.findAllByRole("button", { name: /#5/ })).find(candidate => candidate.className !== "word") ?? fail("no row");
  const name = async () => within(await row()).getByText("session store");
  // SAFETY: the handler needs only the change list the Drawer reads; the other History fields are unused here.
  app.handlers["todo.getHistory"] = () => ({ changes: [{ seq: 2 }], unread: 0 }) as never;
  app.handlers["todo.update"] = () => item();

  fireEvent.dblClick(await name());
  const field = await screen.findByRole("textbox", { name: "Name" });
  noSaveOrCancel();

  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(field.isConnected).toBe(false));
  expect(callsTo(app, "todo.update")).toEqual([]);

  fireEvent.dblClick(await name());
  const again = await screen.findByRole("textbox", { name: "Name" });
  fireEvent.input(again, { target: { value: "session cache" } });
  fireEvent.keyDown(again, { key: "Enter" });

  await waitFor(() => expect(callsTo(app, "todo.update")).toHaveLength(1));
  expect(callsTo(app, "todo.update")[0]?.params).toMatchObject({ title: "session cache" });

  fireEvent.dblClick(await row());
  await screen.findByRole("complementary", { name: "Drawer" });
  cleanup();

  const pads = await openShelf([padOf("notes", AGENT, "a")]);
  const padName = async () => screen.findByText("notes", { selector: ".shelf-title" });
  const renames = () => pads.app.calls.filter(call => call.method === "pad.rename");

  fireEvent.dblClick(await padName());
  const padField = await screen.findByRole("textbox", { name: "Name" });
  noSaveOrCancel();

  fireEvent.keyDown(padField, { key: "Escape" });
  await waitFor(() => expect(padField.isConnected).toBe(false));
  expect(renames()).toEqual([]);

  fireEvent.dblClick(await padName());
  const padAgain = await screen.findByRole("textbox", { name: "Name" });
  flush();
  fireEvent.input(padAgain, { target: { value: "plan" } });
  fireEvent.keyDown(padAgain, { key: "Enter" });

  await waitFor(() => expect(renames()).toHaveLength(1));
  expect(renames()[0]?.params).toMatchObject({ name: "notes", newName: "plan" });
});

it("u7641a_a_todo_body_saves_as_you_type_and_esc_restores", async () => {
  const { app } = await openDrawer();
  fireEvent.dblClick(within(drawer()).getByText("Move the cache."));
  const field = await within(drawer()).findByRole("textbox", { name: "Body" });
  expect(within(drawer()).queryByRole("button", { name: /save/i })).toBeNull();

  fireEvent.input(field, { target: { value: "Move it to redis." } });
  await waitFor(() => expect(callsTo(app, "todo.update")).toEqual([expect.objectContaining({ params: expect.objectContaining({ body: "Move it to redis." }) })]));

  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(callsTo(app, "todo.update").at(-1)?.params).toMatchObject({ body: "Move the cache." }));
});
