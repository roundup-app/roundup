import { stubDialogLayout } from "../shelf/bulkQuestionHarness";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, info } from "../testing/nodes";
import type { MenuItem } from "../app/seam";
import { mountTodos, todo, todoCallsTo as callsTo } from "./testHarness";

afterEach(cleanup);

stubDialogLayout();

const rowOf = async (title: string) => (await screen.findByText(title)).closest<HTMLElement>("[data-todo]")!;

it("u2694a_each_object_builds_its_items_todo", async () => {
  const { app } = await mountTodos([todo(5, { title: "session store" })], true);

  fireEvent.contextMenu(await rowOf("session store"), { clientX: 10, clientY: 10 });

  expect(app.menuLabels()).toEqual(["Complete", "Copy Link", "Delete"]);
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

it.each([["pads", true], ["pads", false], ["todos", true], ["todos", false]] as const)("u3812_a_done_todo_menu_has_no_complete_in_the_%s_running_%s", async (surface, running) => {
  const { app, connected } = await mountTodos([todo(5, { title: "session store", done: true, creator: { kind: "agent", id: "a", parent: null } })], true, [agent("a", running ? "idle" : "done", "ready")], true);

  if (!running) {
    app.handlers["terminal.list"] = () => [info("t-a", { running: false, exit_code: 0 })];
    await connected.rail.refresh({ terminals: true });
  }

  if (surface === "pads") fireEvent.click(await screen.findByRole("button", { name: "1 todos" }));
  else fireEvent.click(screen.getByRole("button", { name: /1 done/ }));
  const owner = surface === "pads" ? screen.getByRole("tree", { name: "Rail" }) : screen.getByRole("region", { name: "Todos" });
  const row = (await within(owner).findByText(/session store/)).closest<HTMLElement>("[data-todo]")!;

  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });

  expect(app.menuLabels()).toEqual([...(running ? ["Send to Agent"] : []), "Copy Link", "Delete"]);
  expect(callsTo(app, "todo.complete")).toEqual([]);
});

it.each(["pads", "todos"] as const)("u3812_no_item_of_the_todo_menu_is_built_disabled_%s", async (surface) => {
  const { app, connected } = await mountTodos([todo(5, { title: "session store", creator: { kind: "agent", id: "a", parent: null } })], true, [agent("a", "idle", "ready"), agent("x", "done", "stopped")], true);
  app.handlers["terminal.list"] = () => [info("t-x", { running: false, exit_code: 0 })];
  await connected.rail.refresh({ terminals: true });

  if (surface === "pads") fireEvent.click(await screen.findByRole("button", { name: "1 todos" }));
  const owner = surface === "pads" ? screen.getByRole("tree", { name: "Rail" }) : screen.getByRole("region", { name: "Todos" });
  const row = (await within(owner).findByText(/session store/)).closest<HTMLElement>("[data-todo]")!;
  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });

  const items = app.shownMenus.at(-1)!.items;
  const disabled = (items: MenuItem[]): string[] => items.flatMap(item => [...(item.enabled ? [] : [item.id]), ...disabled(item.children ?? [])]);
  expect(disabled(items)).toEqual([]);
  expect(items.find(item => item.id === "send")?.children?.map(item => item.label)).toEqual(["a"]);
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
