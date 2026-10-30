import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { Actor } from "@contracts/Actor";
import type { Comment } from "@contracts/todo/Comment";
import { RpcError } from "../app/seam";
import { agent } from "../testing/nodes";
import { mountTodos, todo, todoCallsTo } from "./testHarness";

afterEach(cleanup);

const panel = () => screen.getByRole("complementary", { name: "Drawer" });

const AGENT: Actor = { kind: "agent", id: "a", parent: null };

const USER_ACTOR: Actor = { kind: "user", id: "you", parent: null };

const line = (id: number, author: Actor, body: string, read = true): Comment => ({ id, author, body, created_at: id * 60_000, read });

const open = async () => {
  { const focusedRow = await screen.findByRole("button", { name: /^Idle #1 / }); focusedRow.focus(); fireEvent.keyDown(focusedRow, { key: "Enter", code: "Enter" }); }

  await within(panel()).findByRole("region", { name: "Activity" });
};

it("u3741_the_thread_reads_oldest_first_with_authors", async () => {
  const m = await mountTodos([todo(1)], true, [agent("a", "idle", "Idle", { name: "builder" })]);
  m.store.comments!.set(1, [line(1, USER_ACTOR, "first"), line(2, AGENT, "second\nwith a break", false), line(3, USER_ACTOR, "ünï 日本語")]);
  await open();
  const thread = await within(panel()).findAllByText(/first|second|日本語/);
  expect(thread.map((node) => node.textContent)).toEqual(["first", "second\nwith a break", "ünï 日本語"]);
  const section = within(panel()).getByRole("region", { name: "Activity" });
  expect(within(section).getAllByText(/^(Me|builder)$/).map((node) => node.textContent)).toEqual(["Me", "builder", "Me"]);
});

it("u3741_a_todo_with_no_comments_shows_the_field_alone", async () => {
  const m = await mountTodos([todo(1)]);
  await open();
  const section = within(panel()).getByRole("region", { name: "Activity" });
  expect(within(section).queryAllByText(/./, { selector: ".todo-comment" })).toHaveLength(0);
  expect(within(section).getByRole("textbox", { name: "Write a comment" })).toBeTruthy();
  expect(within(section).getByRole("button", { name: "Comment" }).getAttribute("aria-disabled") === "true").toBe(true);
});

it("u3741_a_comment_is_sent_once_and_kept_on_failure", async () => {
  const m = await mountTodos([todo(1)]);
  await open();
  const field = within(panel()).getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
  const original = m.app.handlers["todo.comment"]!;
  m.app.handlers["todo.comment"] = () => Promise.reject(new RpcError(-32003, "Daemon said no"));
  fireEvent.input(field, { target: { value: "keep me" } });
  fireEvent.click(within(panel()).getByRole("button", { name: "Comment" }));
  await within(panel()).findByText("Daemon said no");
  expect(field.value).toBe("keep me");
  m.app.handlers["todo.comment"] = original;
  fireEvent.keyDown(field, { key: "Enter", ctrlKey: true });
  await within(panel()).findByText("keep me", { selector: ".todo-comment-body" });
  expect(field.value).toBe("");
  expect(within(panel()).getByRole("region", { name: "Activity" })).toBeTruthy();
  expect(todoCallsTo(m.app, "todo.comment").map((call) => call.params)).toEqual([{ id: 1, body: "keep me" }, { id: 1, body: "keep me" }]);
  expect(m.store.comments!.get(1)).toHaveLength(1);
});

it("u4698e_reply_keeps_the_todo_destination", async () => {
  const m = await mountTodos([todo(1)]);
  m.store.comments!.set(1, [line(1, AGENT, "which branch?", false), ...Array.from({ length: 21 }, (_, index) => line(index + 2, USER_ACTOR, `Later ${index}`))]);
  await open();
  fireEvent.click(await within(panel()).findByRole("button", { name: /older entr/ }));
  fireEvent.click(await within(panel()).findByRole("button", { name: "Reply" }));
  const field = within(panel()).getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
  expect(document.activeElement).toBe(field);
  fireEvent.input(field, { target: { value: "main" } });
  fireEvent.click(within(panel()).getByRole("button", { name: "Comment" }));
  await waitFor(() => expect(todoCallsTo(m.app, "todo.comment").map(call => call.params)).toEqual([{ id: 1, body: "main" }]));
});

it("u3741_opening_marks_unread_comments_read_once", async () => {
  const m = await mountTodos([todo(1), todo(2)]);
  m.store.comments!.set(1, [line(1, AGENT, "q?", false)]);
  await open();
  await waitFor(() => expect(todoCallsTo(m.app, "todo.markCommentsRead")).toHaveLength(1));
  expect(todoCallsTo(m.app, "todo.markCommentsRead")[0]!.params).toEqual({ id: 1 });
  // A comment that arrives while the Drawer is open is read the same way; nothing else is.
  await m.app.rpc("todo.comment", { id: 1, body: "mine" });
  await waitFor(() => expect(todoCallsTo(m.app, "todo.markCommentsRead")).toHaveLength(1));
  m.store.comments!.set(1, [...m.store.comments!.get(1)!, line(9, AGENT, "again", false)]);
  m.app.emit({ actor: AGENT, name: "todo.commented", data: { id: 1 } });
  await waitFor(() => expect(todoCallsTo(m.app, "todo.markCommentsRead")).toHaveLength(2));
});

it("u3741_a_thread_with_nothing_unread_marks_nothing", async () => {
  const m = await mountTodos([todo(1)]);
  m.store.comments!.set(1, [line(1, USER_ACTOR, "mine")]);
  await open();
  await within(panel()).findByText("mine", { selector: ".todo-comment-body" });
  expect(todoCallsTo(m.app, "todo.markCommentsRead")).toHaveLength(0);
});

const status = "checked\n::status Ran tests: 42 passed\n  42 passed\n  0 failed\n::status Edited lib.rs\nlast";

it("u3774_the_thread_shows_each_author_with_me_or_the_agents_glyph", async () => {
  const m = await mountTodos([todo(1)], true, [agent("a", "idle", "Idle", { name: "builder" })]);
  m.store.comments!.set(1, [line(1, USER_ACTOR, "mine"), line(2, AGENT, "theirs"), line(3, { kind: "agent", id: "gone", parent: null }, "orphan")]);
  await open();
  await within(panel()).findByText("orphan");
  const blocks = [...panel().querySelectorAll<HTMLElement>(".todo-comment")];
  expect(blocks.map((block) => block.querySelector(".todo-comment-author")!.textContent)).toEqual(["Me", "builder", "gone"]);
  expect(blocks.map((block) => block.querySelector("[role=img]") !== null)).toEqual([false, true, false]);
});

it("u3775_a_status_line_is_a_button_that_folds_its_details", async () => {
  const m = await mountTodos([todo(1)], true, [agent("a", "idle", "Idle")]);
  m.store.comments!.set(1, [line(1, AGENT, status)]);
  await open();
  const button = await within(panel()).findByRole("button", { name: "Ran tests: 42 passed" });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(within(panel()).queryByText(/42 passed\n/)).toBeNull();
  fireEvent.click(button);
  await waitFor(() => expect(button.getAttribute("aria-expanded")).toBe("true"));
  expect((await within(panel()).findByText(/0 failed/)).textContent).toBe("42 passed\n0 failed");
  fireEvent.click(button);
  await waitFor(() => expect(button.getAttribute("aria-expanded")).toBe("false"));
  await waitFor(() => expect(within(panel()).queryByText(/0 failed/)).toBeNull());
  expect(within(panel()).queryByRole("button", { name: "Edited lib.rs" })).toBeNull();
  expect(within(panel()).getByText(/Edited lib\.rs/, { selector: "p" })).toBeTruthy();
  expect(within(panel()).getByText("checked")).toBeTruthy();
});

it("u3775_only_an_agents_comment_body_makes_status_lines", async () => {
  const m = await mountTodos([todo(1)]);
  m.store.comments!.set(1, [line(1, USER_ACTOR, "::status Ran tests\n  42 passed")]);
  await open();
  await within(panel()).findByText(/::status Ran tests/);
  expect(within(panel()).queryByRole("button", { name: /Ran tests/ })).toBeNull();
});

it("u3776_enter_sends_once_and_shift_enter_adds_a_line", async () => {
  const m = await mountTodos([todo(1)]);
  await open();
  const field = within(panel()).getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(todoCallsTo(m.app, "todo.comment")).toHaveLength(0);
  fireEvent.input(field, { target: { value: "hello" } });
  expect(fireEvent.keyDown(field, { key: "Enter", shiftKey: true })).toBe(true);
  expect(todoCallsTo(m.app, "todo.comment")).toHaveLength(0);
  fireEvent.keyDown(field, { key: "Enter", isComposing: true });
  expect(todoCallsTo(m.app, "todo.comment")).toHaveLength(0);
  fireEvent.keyDown(field, { key: "Enter" });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(todoCallsTo(m.app, "todo.comment").map((call) => call.params)).toEqual([{ id: 1, body: "hello" }]));
});

it("u3776_a_new_comment_is_announced_politely_and_the_opening_ones_are_not", async () => {
  const author = "builder";
  const m = await mountTodos([todo(1)], true, [agent("a", "idle", "Idle", { name: author })]);
  m.store.comments!.set(1, [line(1, AGENT, "old")]);
  await open();
  await within(panel()).findByText("old");
  const comments = within(panel()).getByRole("region", { name: "Activity" });
  const live = within(comments).getByRole("status");
  expect(live.getAttribute("aria-live")).toBe("polite");
  expect(live.textContent).toBe("");
  const arrival = line(2, AGENT, "new one");
  m.store.comments!.set(1, [...m.store.comments!.get(1)!, arrival]);
  m.app.emit({ actor: AGENT, name: "todo.commented", data: { id: 1 } });
  await waitFor(() => expect(live.textContent).toBe(`${author}: ${arrival.body}`));
});

it("u3776_an_arrival_keeps_earlier_rows_and_an_open_status_line", async () => {
  const m = await mountTodos([todo(1)], true, [agent("a", "idle", "Idle")]);
  m.store.comments!.set(1, [line(1, AGENT, status)]);
  await open();
  const button = await within(panel()).findByRole("button", { name: "Ran tests: 42 passed" });
  const row = panel().querySelector("[data-comment='1']");
  fireEvent.click(button);
  await waitFor(() => expect(button.getAttribute("aria-expanded")).toBe("true"));
  button.focus();
  m.store.comments!.set(1, [...m.store.comments!.get(1)!, line(2, AGENT, "new one")]);
  m.app.emit({ actor: AGENT, name: "todo.commented", data: { id: 1 } });
  await within(panel()).findByText("new one");
  expect(panel().querySelector("[data-comment='1']")).toBe(row);
  expect(button.isConnected).toBe(true);
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(button);
});
