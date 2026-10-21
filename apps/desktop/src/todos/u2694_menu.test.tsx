import { stubDialogLayout } from "../shelf/bulkQuestionHarness";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo, todoCallsTo as callsTo } from "./testHarness";

afterEach(cleanup);

stubDialogLayout();

const rowOf = async (title: string) => (await screen.findByText(title)).closest<HTMLElement>("[data-todo]")!;

it("u2694a_each_object_builds_its_items_todo", async () => {
  const { app } = await mountTodos([todo(5, { title: "session store" })], true);

  fireEvent.contextMenu(await rowOf("session store"), { clientX: 10, clientY: 10 });

  expect(app.menuLabels()).toEqual(["Complete", "Send to Agent", "Copy Link", "Delete"]);
  await app.pickMenu("Delete");
  await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
  expect(callsTo(app, "todo.delete")).toEqual([]);
});

it("u2694b_complete_calls_todo_complete", async () => {
  const { app } = await mountTodos([todo(5, { title: "session store" })], true);

  fireEvent.contextMenu(await rowOf("session store"), { clientX: 10, clientY: 10 });
  await app.pickMenu("Complete");

  await waitFor(() => expect(callsTo(app, "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 5 } }]));
});

it("u2694b_a_completed_todo_keeps_complete_disabled", async () => {
  const { app } = await mountTodos([todo(5, { title: "session store", done: true })], true);

  fireEvent.click(screen.getByRole("button", { name: /1 done/ }));
  fireEvent.contextMenu(await rowOf("session store"), { clientX: 10, clientY: 10 });

  expect(app.shownMenus.at(-1)!.items.find((item) => item.id === "complete"))
    .toMatchObject({ enabled: false });
  await app.pickMenu("Complete");
  expect(callsTo(app, "todo.complete")).toEqual([]);
});

it("u2694b_deleting_a_completed_todo_keeps_other_completed_todos", async () => {
  const { app } = await mountTodos([todo(5, { title: "chosen", done: true }), todo(6, { title: "keep", done: true })], true);

  fireEvent.click(screen.getByRole("button", { name: /2 done/ }));
  fireEvent.contextMenu(await rowOf("chosen"), { clientX: 10, clientY: 10 });
  await app.pickMenu("Delete");
  await screen.findByRole("alertdialog");
  expect(callsTo(app, "todo.delete")).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));

  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(callsTo(app, "todo.delete")).toEqual([{ method: "todo.delete", params: { id: 5 } }]);
  expect(await rowOf("keep")).toBeTruthy();
});
