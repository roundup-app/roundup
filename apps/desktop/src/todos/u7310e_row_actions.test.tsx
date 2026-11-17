import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { Actor } from "@contracts/Actor";
import type { Comment } from "@contracts/todo/Comment";
import { padOf } from "../pads/padsFixture";
import { agent, USER } from "../testing/nodes";
import { padHandlers } from "../testing/stores";
import { mountTodos, todo, todoCallsTo } from "./testHarness";

afterEach(cleanup);

const panel = () => screen.getByRole("complementary", { name: "Drawer" });

const AGENT: Actor = { kind: "agent", id: "a", parent: null };

const line = (id: number, author: Actor, body: string): Comment => ({ id, author, body, created_at: id * 60_000, read: true });

const URL = "roundup://pad/notes?project=k";

// A Todo with the user's comment, an Agent's comment, a Pad ref and its history.
const open = async () => {
  const m = await mountTodos([todo(1, { refs: [URL] })], true, [agent("a", "idle", "Idle", { name: "builder" })]);
  m.store.comments?.set(1, [line(1, USER, "mine"), line(2, AGENT, "which branch?")]);
  Object.assign(m.app.handlers, padHandlers({ pads: [padOf("notes", USER, "one")], history: [] }, () => {}));
  const row = await screen.findByRole("button", { name: /^Idle #1 / });
  row.focus();
  fireEvent.keyDown(row, { key: "Enter", code: "Enter" });
  const activity = await within(panel()).findByRole("region", { name: "Activity" });
  const refs = await within(panel()).findByRole("region", { name: /^Pads · / });

  const [mine, theirs] = await waitFor(() => {
    const [first, second] = activity.querySelectorAll<HTMLElement>("[data-comment]");

    if (!first || !second) throw new Error("the thread shows both comments");

    return [first, second] as const;
  });

  return { m, activity, refs, mine, theirs };
};

it("u7310e_icon_actions_are_named_by_their_labels", async () => {
  const { m, activity, refs, mine, theirs } = await open();
  const historyCopy = await waitFor(() => within(activity).getAllByRole("button", { name: "Copy" }).filter(button => !button.closest("[data-comment]"))[0]);

  const actions = [
    historyCopy,
    within(mine).getByRole("button", { name: "Copy" }),
    within(theirs).getByRole("button", { name: "Copy" }),
    within(theirs).getByRole("button", { name: "Reply" }),
    within(refs).getByRole("button", { name: "Unlink notes" }),
    within(activity).getByRole("button", { name: "Comment" }),
  ];

  for (const button of actions) {
    if (!button) throw new Error("every action shows");

    // An icon: no text of its own; the shared Tooltip shows its name.
    expect(button.textContent).toBe("");
    fireEvent.keyDown(document, { key: "Tab" });
    button.focus();
    const tip = await screen.findByRole("tooltip");
    expect(tip.textContent).toBe(button.getAttribute("aria-label"));
    expect(button.getAttribute("aria-describedby")).toBe(tip.id);
    button.blur();
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  }

  // A comment's Copy writes its text.
  fireEvent.click(within(theirs).getByRole("button", { name: "Copy" }));
  await waitFor(() => expect(m.app.clipboardWrites).toEqual(["which branch?"]));
});

it("u7310e_right_click_and_keys_open_the_row_menu", async () => {
  const { m, activity, refs, mine, theirs } = await open();
  const field = within(activity).getByRole("textbox", { name: "Write a comment" });
  const reply = within(theirs).getByRole("button", { name: "Reply" });
  const copy = within(theirs).getByRole("button", { name: "Copy" });

  // A right-click on an Agent's comment shows Reply and Copy, named as its icons; Copy writes the comment's text.
  fireEvent.contextMenu(within(theirs).getByText("which branch?"));
  expect(m.app.menuLabels()).toEqual([reply.getAttribute("aria-label"), copy.getAttribute("aria-label")]);
  await m.app.pickMenu("Copy");
  await waitFor(() => expect(m.app.clipboardWrites).toEqual(["which branch?"]));

  fireEvent.contextMenu(theirs);
  await m.app.pickMenu("Reply");
  expect(document.activeElement).toBe(field);

  // ContextMenu with focus in the user's comment shows its Copy.
  const mineCopy = within(mine).getByRole("button", { name: "Copy" });
  mineCopy.focus();
  fireEvent.keyDown(mineCopy, { key: "ContextMenu", code: "ContextMenu" });
  expect(m.app.menuLabels()).toEqual([mineCopy.getAttribute("aria-label")]);
  await m.app.pickMenu("Copy");
  await waitFor(() => expect(m.app.clipboardWrites).toEqual(["which branch?", "mine"]));

  // Shift+F10 on a Pad ref's link shows Unlink, named as its icon, and choosing it unlinks once.
  const unlink = within(refs).getByRole("button", { name: "Unlink notes" });
  const link = within(refs).getByRole("link");
  link.focus();
  fireEvent.keyDown(link, { key: "F10", code: "F10", shiftKey: true });
  expect(m.app.menuLabels().at(-1)).toBe(unlink.getAttribute("aria-label"));
  await m.app.pickMenu("Unlink notes");
  await waitFor(() => expect(todoCallsTo(m.app, "todo.removeRef").map(call => call.params)).toEqual([{ id: 1, url: URL }]));
});
