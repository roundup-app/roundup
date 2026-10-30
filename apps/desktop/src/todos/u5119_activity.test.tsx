import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo, todoCallsTo } from "./testHarness";

// U5119 uses the scenario's existing App seam, with independent source failures.
afterEach(cleanup);

const values = { title: "Original", body: "", done: false, blockers: [], owner: null, priority: null };

const comments = (count: number, start = 1) => Array.from({ length: count }, (_, index) => ({ id: start + index, body: `Comment ${start + index}`, created_at: (start + index) * 1000, author: { kind: "user" as const, id: "you", parent: null }, read: false }));

const changes = (count: number, start = 1) => Array.from({ length: count }, (_, index) => ({ seq: start + index, actor: null, changed_at: (start + index) * 1000, before: values, after: { ...values, title: `Change ${start + index}` } }));

const identities = () => [...document.querySelectorAll('.todo-comments [data-comment], .todo-comments [data-change]')].map(entry => entry.hasAttribute('data-comment') ? `c${entry.getAttribute('data-comment')}` : `h${entry.getAttribute('data-change')}`);

const ids = (source: string, start: number, end: number) => Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => `${source}${start + index}`);

const retry = () => fireEvent.click(screen.getByRole("button", { name: /^Retry / }));

const opening = async (failed: "comments" | "history", count: number, unread = 1) => {
  const m = await mountTodos([todo(1)]);
  m.app.handlers["todo.comments"] = () => {
    if (failed === "comments") throw new Error("Comments unavailable; connection lost. Retry to load comments.");

    return comments(count);
  };

  m.app.handlers["todo.getHistory"] = () => {
    if (failed === "history") throw new Error("History unavailable; connection lost. Retry to load history.");

    return { unread, changes: changes(count) };
  };

  const row = await screen.findByRole("button", { name: /^Idle #1 / }); row.focus();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  await screen.findByRole("textbox", { name: "Write a comment" });
  await screen.findByRole("alert");

  return m;
};

it.each(["comments", "history"] as const)("u5119_available_activity_is_bounded_despite_a_failed_source_%s", async failed => {
  await opening(failed, 30);
  const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
  const source = failed === "comments" ? "h" : "c";
  expect(identities()).toEqual(ids(source, 11, 30));
  const draft = "Still editable 雪";
  fireEvent.input(field, { target: { value: draft } });
  expect(field.value).toBe(draft);
});

it.each(["comments", "history"] as const)("u5119_available_activity_is_bounded_despite_a_failed_source_empty_%s", async failed => {
  const m = await opening(failed, 0);
  const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
  expect(identities()).toEqual([]);
  expect(document.querySelector(".todo-older")).toBeNull();
  expect(field.disabled).toBe(false);
  expect(todoCallsTo(m.app, failed === "comments" ? "todo.markCommentsRead" : "todo.readHistory")).toHaveLength(0);
});

it.each((["comments", "history"] as const).flatMap(failed => [0, 3, 30].flatMap(count => (count === 30 ? [false, true] : [false]).map(expanded => ({ failed, expanded, count })))))("u5119_retry_preserves_the_opening_fold $failed / $expanded / $count", async ({ failed, expanded, count }) => {
  const m = await opening(failed, count);
  const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
  const available = failed === "comments" ? "h" : "c";
  const recovered = failed === "comments" ? "c" : "h";
  const draft = " Unsent\n日本語 é\n";
  fireEvent.input(field, { target: { value: draft } });

  if (expanded && count === 30) {
    fireEvent.click(screen.getByRole("button", { name: /older entr/ }));
    await waitFor(() => expect(identities()).toHaveLength(30));
  }

  field.focus();
  // Recovery has ten entries older than the exposed boundary and five newer.
  const recoveredComments = count === 30 ? [...comments(10, -9), ...comments(5, 31)] : comments(30);
  const recoveredChanges = count === 30 ? [...changes(10, -9), ...changes(5, 31)] : changes(30);

  if (failed === "comments") m.app.handlers["todo.comments"] = () => recoveredComments;
  else m.app.handlers["todo.getHistory"] = () => ({ unread: null, changes: recoveredChanges });
  retry();
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

  const expected = count === 30 ? [...(expanded ? [...ids(recovered, -9, 0), ...ids(available, 1, 10)] : []), ...ids(available, 11, 30), ...ids(recovered, 31, 35)]
    : count === 0 ? ids(recovered, 11, 30)
    : Array.from({ length: 30 }, (_, index) => index < 3 ? [`h${index + 1}`, `c${index + 1}`] : [`${recovered}${index + 1}`]).flat();

  expect(identities()).toEqual(expected);
  expect(field.value).toBe(draft);
  expect(document.activeElement).toBe(field);
  expect(todoCallsTo(m.app, "todo.comment")).toHaveLength(0);
  expect(todoCallsTo(m.app, "todo.update")).toHaveLength(0);

  if (count === 30) {
    const disclosure = screen.getByRole("button", { name: /older entr/ });
    expect(disclosure.getAttribute("aria-expanded")).toBe(String(expanded));

    if (!expanded) fireEvent.click(disclosure);
    await waitFor(() => expect(identities()).toEqual([...ids(recovered, -9, 0), ...ids(available, 1, 30), ...ids(recovered, 31, 35)]));
  }
});

it.each([1, 21])("u5119_reads_do_not_wait_for_the_failed_source_comments_unread_%s", async unread => {
  const m = await opening("comments", 30, unread);
  const reads = () => todoCallsTo(m.app, "todo.readHistory").map(call => call.params);

  if (unread === 1) {
    expect(reads()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /older entr/ }));
  }

  await waitFor(() => expect(reads()).toEqual([{ id: 1, through: 30 }]));
  expect(todoCallsTo(m.app, "todo.markCommentsRead")).toHaveLength(0);
  m.app.handlers["todo.comments"] = () => comments(30); retry();
  await waitFor(() => expect(todoCallsTo(m.app, "todo.markCommentsRead").map(call => call.params)).toEqual([{ id: 1 }]));
  expect(reads()).toEqual([{ id: 1, through: 30 }]);
});

it("u5119_reads_do_not_wait_for_the_failed_source_history", async () => {
  const m = await opening("history", 30);
  expect(todoCallsTo(m.app, "todo.markCommentsRead").map(call => call.params)).toEqual([{ id: 1 }]);
  expect(todoCallsTo(m.app, "todo.readHistory")).toHaveLength(0);
  m.app.handlers["todo.getHistory"] = () => ({ unread: 1, changes: changes(1) });
  retry();
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(todoCallsTo(m.app, "todo.readHistory")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: /older entr/ }));
  await waitFor(() => expect(todoCallsTo(m.app, "todo.readHistory").map(call => call.params)).toEqual([{ id: 1, through: 1 }]));
  expect(todoCallsTo(m.app, "todo.markCommentsRead")).toHaveLength(1);
});
