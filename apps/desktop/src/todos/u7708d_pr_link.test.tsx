import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { USER } from "../testing/nodes";
import { mountTodos, todo, todoCallsTo } from "./testHarness";

afterEach(cleanup);

const panel = () => screen.getByRole("complementary", { name: "Drawer" });

const open = async (todos: ReturnType<typeof todo>[], prs?: Map<number, { state: "merged" | "open" | "draft" | "closed" | "unknown"; cause?: string }>) => {
  const m = await mountTodos(todos);

  if (prs) m.store.prs = prs;
  const row = await screen.findByRole("button", { name: /^Idle #1 / });
  row.focus();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  await within(panel()).findByRole("region", { name: "Pull request" });

  return m;
};

const only = <T,>(items: T[], at: number): T => {
  const found = items[at];

  if (found === undefined) throw new Error(`no call ${at}`);

  return found;
};

const first = (m: { store: { todos: ReturnType<typeof todo>[] } }) => only(m.store.todos, 0);

const section = () => within(panel()).getByRole("region", { name: "Pull request" });

it("u7708d_the_drawer_sets_and_clears_the_link", async () => {
  const m = await open([todo(1)]);
  // Keyboard: type the number and press Enter.
  const field = within(section()).getByRole("textbox", { name: "PR number" });
  fireEvent.input(field, { target: { value: "12" } });
  fireEvent.submit(only([...panel().querySelectorAll("form")], 0));
  await waitFor(() => expect(todoCallsTo(m.app, "todo.update")).toHaveLength(1));
  expect(only(todoCallsTo(m.app, "todo.update"), 0).params).toMatchObject({ id: 1, pr: 12 });
  // The Daemon's event, not the click, brings the link into the Drawer.
  m.app.emit({ actor: USER, name: "todo.updated", data: first(m) });
  await within(section()).findByText("Pull request #12");
  fireEvent.click(within(section()).getByRole("button", { name: "Unlink" }));
  await waitFor(() => expect(todoCallsTo(m.app, "todo.update")).toHaveLength(2));
  expect(only(todoCallsTo(m.app, "todo.update"), 1).params).toMatchObject({ id: 1, pr: null });
  m.app.emit({ actor: USER, name: "todo.updated", data: first(m) });
  await within(section()).findByRole("textbox", { name: "PR number" });
});

it("u7708d_a_linked_open_todo_reads_once_and_shows_its_state", async () => {
  const m = await open([todo(1, { pr: 7 })], new Map([[7, { state: "draft" }]]));
  await within(section()).findByText("Work in progress");
  expect(todoCallsTo(m.app, "todo.checkPr")).toHaveLength(1);
  expect(only(todoCallsTo(m.app, "todo.checkPr"), 0).params).toEqual({ id: 1 });
});

it("u7708d_a_merged_pr_marks_the_todo_done_and_shows_it", async () => {
  const m = await open([todo(1, { pr: 7 })], new Map([[7, { state: "merged" }]]));
  await within(section()).findByText("Merged, marked done");
  await waitFor(() => expect(first(m).done).toBe(true));
  expect(todoCallsTo(m.app, "todo.checkPr")).toHaveLength(1);
});

it("u7708d_a_failed_read_shows_its_cause", async () => {
  await open([todo(1, { pr: 7 })], new Map([[7, { state: "unknown", cause: "gh: not logged in" }]]));
  await within(section()).findByText("Read failed: gh: not logged in");
});

it("u7708d_a_failed_read_can_be_read_again", async () => {
  const m = await open([todo(1, { pr: 7 })], new Map([[7, { state: "unknown", cause: "gh: offline" }]]));
  await within(section()).findByText("Read failed: gh: offline");
  m.store.prs = new Map([[7, { state: "open" }]]);
  fireEvent.click(within(section()).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(within(section()).queryByText(/Read failed/)).toBeNull());
  expect(todoCallsTo(m.app, "todo.checkPr")).toHaveLength(2);
});

it("u7708d_an_unlinked_todo_reads_nothing", async () => {
  const m = await open([todo(1)]);
  expect(todoCallsTo(m.app, "todo.checkPr")).toHaveLength(0);
  expect(todoCallsTo(m.app, "todo.checkPrs")).toHaveLength(0);
});

it("u7708d_the_lane_reads_once_on_open", async () => {
  const m = await mountTodos([todo(1, { pr: 7 }), todo(2, { pr: 8, done: true }), todo(3)]);
  await screen.findByRole("button", { name: /^Idle #1 / });
  await waitFor(() => expect(todoCallsTo(m.app, "todo.checkPrs")).toHaveLength(1));
  expect(todoCallsTo(m.app, "todo.checkPr")).toHaveLength(0);
});
