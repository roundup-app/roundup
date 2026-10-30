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
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  const section = await screen.findByRole("region", { name: "Activity" });
  await waitFor(() => expect(section.querySelectorAll('[data-comment], [data-change]')).toHaveLength(20));
  expect(todoCallsTo(m.app, "todo.readHistory")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: /older entr/ }));
  await waitFor(() => expect(todoCallsTo(m.app, "todo.readHistory").map(call => call.params)).toEqual([{ id: 1, through: 2 }]));
  const entries = [...section.querySelectorAll('[data-comment], [data-change]')];
  expect(entries.slice(0, 5).map(entry => entry.getAttribute("data-comment") ?? `change-${entry.getAttribute("data-change")}`)).toEqual(["change-1", "1", "2", "change-2", "3"]);
  expect(entries[3]!.textContent).toMatch(/Renamed.*Wrote the body/s);
});
