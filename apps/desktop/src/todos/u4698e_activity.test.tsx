import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo, todoCallsTo } from "./testHarness";

afterEach(cleanup);

it("u4698e_activity_merges_sources_and_keeps_read_boundaries", async () => {
  const m = await mountTodos([todo(1)]);
  const values = { title: "Original", body: "", done: false, blockers: [], owner: null, priority: null };
  m.app.handlers["todo.getHistory"] = () => ({ unread: 1, changes: [
    { seq: 1, actor: null, changed_at: null, before: null, after: values },
    { seq: 2, actor: null, changed_at: 30_000, before: values, after: { ...values, title: "Renamed", body: "Written" } },
  ] });
  m.store.comments!.set(1, Array.from({ length: 21 }, (_, index) => ({ id: index + 1, body: `Comment ${index + 1}`, created_at: (index + 1) * 10_000, author: { kind: "user" as const, id: "you", parent: null }, read: true })));
  const row = await screen.findByRole("button", { name: /^Idle #1 / });
  row.focus();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  await screen.findByRole("textbox", { name: "Write a comment" });
  const section = document.querySelector(".todo-comments")!;
  await waitFor(() => expect(section.querySelectorAll('[data-comment], [data-change]')).toHaveLength(20));
  expect(todoCallsTo(m.app, "todo.readHistory")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: /older entr/ }));
  await waitFor(() => expect(todoCallsTo(m.app, "todo.readHistory").map(call => call.params)).toEqual([{ id: 1, through: 2 }]));
  const entries = [...section.querySelectorAll('[data-comment], [data-change]')];
  expect(entries.slice(0, 5).map(entry => entry.getAttribute("data-comment") ?? `change-${entry.getAttribute("data-change")}`)).toEqual(["change-1", "1", "2", "change-2", "3"]);
  expect(entries[3]!.textContent).toMatch(/Renamed.*Wrote the body/s);
});

it.each([0, 3, 20, 21, 200])("u4698e_older_activity_unfolds_without_mutation_%s", async count => {
  const m = await mountTodos([todo(1)]);
  m.app.handlers["todo.getHistory"] = () => ({ unread: null, changes: [] });
  const comments = Array.from({ length: count }, (_, index) => ({ id: index + 1, body: `Entry ${index + 1}`, created_at: index * 1000, author: { kind: "agent" as const, id: "a", parent: null }, read: true }));
  m.store.comments!.set(1, comments);
  const row = await screen.findByRole("button", { name: /^Idle #1 / }); row.focus();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  await screen.findByRole("textbox", { name: "Write a comment" });
  const section = document.querySelector(".todo-comments")!;
  await waitFor(() => expect(section.querySelectorAll('[data-comment]')).toHaveLength(Math.min(count, 20)));
  const control = screen.queryByRole("button", { name: /older entr/ });
  expect(!!control).toBe(count > 20);
  const field = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
  fireEvent.input(field, { target: { value: "Unsent\n雪" } });

  if (control) {
    fireEvent.click(control);
    await waitFor(() => expect(section.querySelectorAll('[data-comment]')).toHaveLength(count));
    expect([...section.querySelectorAll('[data-comment]')].map(node => Number(node.getAttribute('data-comment')))).toEqual(comments.map(comment => comment.id));
  }

  m.store.comments!.set(1, [...comments, { id: count + 1, body: "Arrived", created_at: count * 1000, author: { kind: "user", id: "you", parent: null }, read: true }]);
  m.app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "todo.commented", data: { id: 1 } });
  await screen.findByText("Arrived");
  expect(section.querySelectorAll('[data-comment]')).toHaveLength(count + 1);
  expect(field.value).toBe("Unsent\n雪");
  expect(todoCallsTo(m.app, "todo.comment")).toHaveLength(0);
  expect(todoCallsTo(m.app, "todo.update")).toHaveLength(0);
});
