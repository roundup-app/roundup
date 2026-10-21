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
  fireEvent.click(await screen.findByRole("button", { name: /^Idle #1 / }));
  await within(panel()).findByRole("region", { name: /^Comments · / });
};

it("u3741_the_thread_reads_oldest_first_with_authors", async () => {
  const m = await mountTodos([todo(1)], true, [agent("a", "idle", "Idle", { name: "builder" })]);
  m.store.comments!.set(1, [line(1, USER_ACTOR, "first"), line(2, AGENT, "second\nwith a break", false), line(3, USER_ACTOR, "ünï 日本語")]);
  await open();
  const thread = await within(panel()).findAllByText(/first|second|日本語/);
  expect(thread.map((node) => node.textContent)).toEqual(["first", "second\nwith a break", "ünï 日本語"]);
  const section = within(panel()).getByRole("region", { name: "Comments · 3" });
  expect(within(section).getAllByText(/^(Me|builder)$/).map((node) => node.textContent)).toEqual(["Me", "builder", "Me"]);
});

it("u3741_a_todo_with_no_comments_shows_the_field_alone", async () => {
  const m = await mountTodos([todo(1)]);
  await open();
  const section = within(panel()).getByRole("region", { name: "Comments · 0" });
  expect(within(section).queryAllByText(/./, { selector: ".todo-comment" })).toHaveLength(0);
  expect(within(section).getByRole("textbox", { name: "Write a comment" })).toBeTruthy();
  expect(within(section).getByRole("button", { name: "Comment" }).hasAttribute("disabled")).toBe(true);
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
  expect(within(panel()).getByRole("region", { name: "Comments · 1" })).toBeTruthy();
  expect(todoCallsTo(m.app, "todo.comment").map((call) => call.params)).toEqual([{ id: 1, body: "keep me" }, { id: 1, body: "keep me" }]);
  expect(m.store.comments!.get(1)).toHaveLength(1);
});

it("u3741_reply_focuses_the_field_and_sends_an_ordinary_comment", async () => {
  const m = await mountTodos([todo(1)]);
  m.store.comments!.set(1, [line(1, AGENT, "which branch?", false)]);
  await open();
  fireEvent.click(within(panel()).getByRole("button", { name: "Reply" }));
  const field = within(panel()).getByRole<HTMLTextAreaElement>("textbox", { name: "Write a comment" });
  expect(document.activeElement).toBe(field);
  fireEvent.input(field, { target: { value: "main" } });
  fireEvent.click(within(panel()).getByRole("button", { name: "Comment" }));
  await waitFor(() => expect(m.store.comments!.get(1)!.map((comment) => comment.author.kind)).toEqual(["agent", "user"]));
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
