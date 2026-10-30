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

const opening = async (failed: "comments" | "history", count: number, unread = 1) => {
  const m = await mountTodos([todo(1)]);
  let rejects = true;
  const method = failed === "comments" ? "todo.comments" : "todo.getHistory";
  m.app.handlers["todo.comments"] = () => {
    if (rejects && failed === "comments") throw new Error("Comments unavailable; connection lost. Retry to load comments.");
    return comments(count);
  };
  m.app.handlers["todo.getHistory"] = () => {
    if (rejects && failed === "history") throw new Error("History unavailable; connection lost. Retry to load history.");
    return { unread, changes: changes(count) };
  };
  const row = await screen.findByRole("button", { name: /^Idle #1 / }); row.focus();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  const field = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
  await screen.findByRole("alert");
  return { ...m, field, method, recover: () => { rejects = false; }, retry: () => fireEvent.click(screen.getByRole("button", { name: "Retry" })) };
};

it.each(["comments", "history"] as const)("u5119_available_activity_is_bounded_despite_a_failed_source_%s", async failed => {
  const m = await opening(failed, 30);
  const source = failed === "comments" ? "h" : "c";
  expect(identities()).toEqual(ids(source, 11, 30));
  expect(screen.getByRole("button", { name: /older entr/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  fireEvent.input(m.field, { target: { value: "Still editable 雪" } });
  expect(m.field.value).toBe("Still editable 雪");
});

it.each(["comments", "history"] as const)("u5119_available_activity_is_bounded_despite_a_failed_source_empty_%s", async failed => {
  const m = await opening(failed, 0);
  expect(identities()).toEqual([]);
  expect(screen.queryByRole("button", { name: /older entr/ })).toBeNull();
  expect(m.field.disabled).toBe(false);
  expect(todoCallsTo(m.app, failed === "comments" ? "todo.markCommentsRead" : "todo.readHistory")).toHaveLength(0);
});
