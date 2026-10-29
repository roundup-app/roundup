import { questionProbe } from "../testing/menuProbe";
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

  expect(app.shownMenus.at(-1)!.items.map(item => [item.id, item.group])).toEqual([["open", "0"], ["complete", "3"], ["copy-link", "4"], ["rename", "5"], ["assign", "5"], ["move", "5"], ["delete", "7"]]);
  await app.pickMenu("Delete");
  await waitFor(() => expect(callsTo(app, "todo.delete")).toEqual([{ method: "todo.delete", params: { operation: expect.any(String), ids: [5] } }]));
  expect(questionProbe.count).toBe(0);
});

it("u2694b_complete_calls_todo_complete", async () => {
  const { app } = await mountTodos([todo(5, { title: "session store" })], true);

  fireEvent.contextMenu(await rowOf("session store"), { clientX: 10, clientY: 10 });
  await app.pickMenu("Complete");

  await waitFor(() => expect(callsTo(app, "todo.complete")).toEqual([{ method: "todo.complete", params: { id: 5 } }]));
});

it.each([["todos", true, true], ["todos", true, false], ["todos", false, false]] as const)("u3812_todo_menu_omits_unavailable_actions_%s_done_%s_running_%s", async (surface, done, running) => {
  const { app, connected } = await mountTodos([todo(5, { title: "session store", done, creator: { kind: "agent", id: "a", parent: null } })], true, [agent("a", running ? "idle" : "done", "ready")], true);

  if (!running) {
    app.handlers["terminal.list"] = () => [info("t-a", { running: false, exit_code: 0 })];
    await connected.rail.refresh({ terminals: true });
  }

  if (done) fireEvent.click(screen.getByRole("button", { name: /1 done/ }));
  const owner = screen.getByRole("region", { name: "Todos" });
  const row = (await within(owner).findByText(/session store/)).closest<HTMLElement>("[data-todo]")!;

  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });

  expect(app.menuLabels()).toEqual(expect.arrayContaining([...(done ? [] : ["Complete"]), ...(running ? ["Send to Agent"] : []), "Copy link", "Delete"]));

  if (done) expect(app.menuLabels()).not.toContain("Complete");
  expect(app.shownMenus.at(-1)!.items.find(item => item.id === "send")?.enabled).toBe(running ? true : undefined);
  expect(callsTo(app, "todo.complete")).toEqual([]);
});

it.each([["todos", false], ["todos", true]] as const)("u3812_multiple_eligible_recipients_lists_only_them_in_rail_order_%s_done_%s", async (surface, done) => {
  const { app, connected } = await mountTodos([todo(5, { title: "session store", done, creator: { kind: "agent", id: "a", parent: null } })], true, [agent("a", "idle", "ready"), agent("x", "done", "stopped"), agent("b", "working", "busy")], true);
  app.handlers["terminal.list"] = () => [info("t-x", { running: false, exit_code: 0 })];
  await connected.rail.refresh({ terminals: true });

  if (done) fireEvent.click(screen.getByRole("button", { name: /1 done/ }));
  const owner = screen.getByRole("region", { name: "Todos" });
  const row = (await within(owner).findByText(/session store/)).closest<HTMLElement>("[data-todo]")!;
  fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });

  const items = app.shownMenus.at(-1)!.items;
  const disabled = (items: MenuItem[]): string[] => items.flatMap(item => [...(item.enabled ? [] : [item.id]), ...disabled(item.children ?? [])]);
  expect(disabled(items.find(item => item.id === "send")?.children ?? [])).toEqual([]);
  expect(items.find(item => item.id === "send")?.children?.map(item => item.label)).toEqual(["a", "b"]);
});

it("u2694b_deleting_a_completed_todo_keeps_other_completed_todos", async () => {
  const { app } = await mountTodos([todo(5, { title: "chosen", done: true }), todo(6, { title: "keep", done: true })], true);

  fireEvent.click(screen.getByRole("button", { name: /2 done/ }));
  fireEvent.contextMenu(await rowOf("chosen"), { clientX: 10, clientY: 10 });
  await app.pickMenu("Delete");
  await waitFor(() => expect(callsTo(app, "todo.delete")).toEqual([{ method: "todo.delete", params: { operation: expect.any(String), ids: [5] } }]));
  expect(questionProbe.count).toBe(0);
  expect(await rowOf("keep")).toBeTruthy();
});
