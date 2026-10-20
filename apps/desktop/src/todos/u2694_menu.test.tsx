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
