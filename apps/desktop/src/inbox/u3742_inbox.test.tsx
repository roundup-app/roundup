import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { Actor } from "@contracts/Actor";
import type { Comment } from "@contracts/todo/Comment";
import { agent } from "../testing/nodes";
import { mountTodos, todo, todoCallsTo } from "../todos/testHarness";
import { ConnectedProjectContext } from "../state/connectedProject";
import { Inbox } from "./Inbox";

afterEach(cleanup);

const panel = () => screen.getByRole("region", { name: "Needs you" });

const AGENT: Actor = { kind: "agent", id: "a", parent: null };

const line = (id: number, body: string, read = false): Comment => ({ id, author: AGENT, body, created_at: id, read });

it("u3742_an_unread_agent_comment_is_a_needs_you_row_until_opened", async () => {
  const m = await mountTodos([todo(1, { title: "Ship" }), todo(2)], true, [agent("a", "idle", "Idle", { name: "builder" })]);
  const comment = line(1, "which branch?");
  m.store.comments!.set(1, [comment]);
  render(() => <ConnectedProjectContext.Provider value={m.connected}><Inbox /></ConnectedProjectContext.Provider>);
  const row = await within(panel()).findByRole("button", { name: /builder.*Ship/ });
  expect(row.textContent).toContain(comment.body);
  // The row is read from `todo.unread`, makes no Message call and sets no Rail Kind.
  expect(todoCallsTo(m.app, "todo.unread").length).toBeGreaterThan(0);
  expect(m.app.calls.some((call) => call.method.startsWith("message."))).toBe(false);

  // A comment that arrives while the Inbox is open joins it; a deleted Todo's leaves it.
  m.store.comments!.set(2, [line(2, "blocked on CI")]);
  m.app.emit({ actor: AGENT, name: "todo.commented", data: { id: 2 } });
  await within(panel()).findByRole("button", { name: /builder.*todo 2/ });
  await m.app.rpc("todo.delete", { operation: crypto.randomUUID(), ids: [2] });
  m.app.emit({ actor: AGENT, name: "todo.deleted", data: { id: 2 } });
  await waitFor(() => expect(within(panel()).queryByRole("button", { name: /todo 2/ })).toBeNull());

  // Activating the row opens the Todo's Drawer, which marks it read, and the row leaves the Inbox.
  fireEvent.click(within(panel()).getByRole("button", { name: /builder.*Ship/ }));
  await screen.findByRole("region", { name: "Activity" });
  await waitFor(() => expect(todoCallsTo(m.app, "todo.markCommentsRead").map((call) => call.params)).toEqual([{ id: 1 }]));
  m.app.emit({ actor: AGENT, name: "todo.commentsRead", data: { id: 1 } });
  m.connected.drawer.close();
  await within(panel()).findByText("Nothing waits for you");
  expect(within(panel()).queryByRole("button", { name: /commented/ })).toBeNull();
});
