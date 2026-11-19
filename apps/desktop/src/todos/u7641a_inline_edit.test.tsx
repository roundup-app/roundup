import { stubDialogLayout } from "../shelf/bulkQuestionHarness";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";

const fail = (message: string): never => { throw new Error(message); };

import { historyLoaded, mountTodos, todo, todoCallsTo as callsTo } from "./testHarness";

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

it("u7641a_double_click_renames_a_todo_and_a_pad_in_place", async () => {
  const { app } = await mountTodos([item()], true);
  const row = (await screen.findAllByRole("button", { name: /#5/ })).find(candidate => candidate.className !== "word") ?? fail("no row");
  // SAFETY: the handler needs only the change list the Drawer reads; the other History fields are unused here.
  app.handlers["todo.getHistory"] = () => ({ changes: [{ seq: 2 }], unread: 0 }) as never;
  app.handlers["todo.update"] = () => item();

  fireEvent.dblClick(row);
  const field = await screen.findByRole("textbox", { name: "Name" });

  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(field.isConnected).toBe(false));
  expect(callsTo(app, "todo.update")).toEqual([]);

  fireEvent.dblClick((await screen.findAllByRole("button", { name: /#5/ })).find(candidate => candidate.className !== "word") ?? fail("no row"));
  const again = await screen.findByRole("textbox", { name: "Name" });
  fireEvent.input(again, { target: { value: "session cache" } });
  fireEvent.keyDown(again, { key: "Enter" });

  await waitFor(() => expect(callsTo(app, "todo.update")).toHaveLength(1));
});

it("u7641a_a_todo_body_saves_as_you_type_and_esc_restores", async () => {
  const { app } = await openDrawer();
  fireEvent.dblClick(within(drawer()).getByText("Move the cache."));
  const field = await within(drawer()).findByRole("textbox", { name: "Body" });

  fireEvent.input(field, { target: { value: "Move it to redis." } });
  await waitFor(() => expect(callsTo(app, "todo.update")).toEqual([expect.objectContaining({ params: expect.objectContaining({ body: "Move it to redis." }) })]));

  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(callsTo(app, "todo.update").at(-1)?.params).toMatchObject({ body: "Move the cache." }));
});
