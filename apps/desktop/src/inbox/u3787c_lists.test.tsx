import { fireEvent, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { mountApp } from "../testing/appFixture";
import { agent, info, event } from "../testing/nodes";
import { todoHandlers } from "../testing/stores";
import { todo } from "../todos/testHarness";
import { copy } from "./copy";
import { leaderKey } from "../keys/leaderFixture";

// Mounted inventory: Inbox is one mixed content collection, in section order.
// Open/Retry/Dismiss and the comments-read recovery action are not content rows.
const inventory = [{ opening: "⌘K then I", open: () => leaderKey("KeyI") }];

const row = (id: string) => document.querySelector<HTMLElement>(`.inbox [data-collection-value="${id}"]`)!;

const selected = () => [...document.querySelectorAll('.inbox [data-selected="true"]')].map(el => el.getAttribute("data-collection-value"));

const ids = ["a:a", "c:11", "c:12", "a:r", "a:b"];

const mount = async (open: () => boolean) => {
  const result = await mountApp(app => {
    Object.assign(app.handlers, todoHandlers({ todos: [todo(111, { title: "Ship 11" })], comments: new Map([[111, [{ id: 11, author: { kind: "agent", id: "a", parent: null }, body: "Reply 11", created_at: 11, read: false }]]]) }, data => app.emit(event(data))));
    app.handlers["rail.tree"] = () => [agent("a", "needs-you", "asks", { name: "alpha", terminal_id: "requesting-terminal" }), agent("r", "needs-you", "editing", { name: "running" }), agent("b", "needs-you", "finished", { name: "終 é 😀" })];
    app.handlers["terminal.list"] = () => [info("requesting-terminal", { owner: "a" })];
    app.handlers["todo.unread"] = () => [11, 12, 13, 14, 15].map(id => ({ todo: id + 100, title: `Ship ${id}`, comment: { id, author: { kind: "agent", id: "a", parent: null }, body: `Reply ${id}`, created_at: id, read: false } }));
  });

  open();
  await waitFor(() => expect(row("c:15")).toBeTruthy());
  row("c:13").hidden = true;
  row("c:14").setAttribute("aria-disabled", "true");
  row("c:15").parentElement!.setAttribute("inert", "");

  return result;
};

it.each(inventory)("u3787c_each_list_navigates_visible_rows $opening", async ({ open }) => {
  const { app } = await mount(open);
  const before = app.calls.length;
  row("c:11").focus();

  for (const [key, id] of [["Home", "a:a"], ["ArrowUp", "a:a"], ["End", "a:b"], ["ArrowDown", "a:b"], ["ArrowUp", "a:r"], ["ArrowUp", "c:12"], ["ArrowDown", "a:r"], ["終", "a:b"]]) {
    fireEvent.keyDown(document.activeElement!, { key });
    expect(document.activeElement).toBe(row(id!));
  }

  expect(selected()).toEqual(["a:b"]);
  expect(document.querySelector('.inbox [aria-expanded="true"]')).toBeNull();
  expect(document.querySelector('.todo-drawer')).toBeNull();
  expect(app.calls.slice(before)).toEqual([]);
});

it.each(inventory)("u3787c_each_list_selects_only_visible_rows $opening", async ({ open }) => {
  const { app } = await mount(open);
  const before = app.calls.length;
  row("a:a").focus();
  fireEvent.keyDown(row("a:a"), { key: "End" });
  fireEvent.click(row("c:11"), { shiftKey: true });
  expect(selected()).toEqual(["c:11"]);
  fireEvent.click(row("a:b"), { metaKey: true, shiftKey: true });
  expect(selected()).toEqual(["a:b"]);
  fireEvent.click(row("c:11"), { metaKey: true });
  expect(selected()).toEqual(["c:11", "a:b"]);
  fireEvent.click(row("a:r"), { shiftKey: true });
  expect(selected()).toEqual(["c:11", "c:12", "a:r"]);
  fireEvent.click(row("c:12"), { metaKey: true });
  expect(selected()).toEqual(["c:11", "a:r"]);
  fireEvent.click(row("a:b"), { metaKey: true, shiftKey: true });
  expect(selected()).toEqual(["c:12", "a:r", "a:b"]);
  fireEvent.keyDown(row("a:b"), { key: "a", metaKey: true });
  expect(selected()).toEqual(ids);
  expect(app.calls.slice(before)).toEqual([]);
  app.handlers["rail.tree"] = () => [agent("a", "needs-you", "asks", { name: "alpha", terminal_id: "requesting-terminal" }), agent("r", "needs-you", "editing", { name: "running again" }), agent("b", "needs-you", "finished", { name: "終 é 😀" })];
  app.emit(event({ name: "rail.changed" }));
  await within(document.querySelector(".inbox")!).findByRole("button", { name: /running again/ });
  const afterRefresh = app.calls.length;
  row("c:13").hidden = false;
  fireEvent.click(row("c:13"), { metaKey: true });
  expect(selected()).toEqual(["a:a", "c:11", "c:12", "c:13", "a:r", "a:b"]);
  row("c:11").hidden = true;
  fireEvent.keyDown(row("a:b"), { key: "a", metaKey: true });
  expect(selected()).toEqual(["a:a", "c:12", "c:13", "a:r", "a:b"]);
  expect(document.querySelector('.inbox [aria-expanded="true"]')).toBeNull();
  expect(document.querySelector('.rail-row[data-selected=true]')).toBeNull();
  expect(app.calls.slice(afterRefresh)).toEqual([]);
  expect([...document.querySelectorAll('.inbox .inbox-actions button, .inbox .reserved-actions button')].every(el => !el.hasAttribute("data-collection-value"))).toBe(true);
});

it.each(["Enter", " ", "click"])("u3787c_agent_activation_and_Escape_preserve_the_requesting_Terminal_%s", async activation => {
  await mount(inventory[0]!.open);
  const target = row("a:a");
  target.focus();

  if (activation === "click") fireEvent.click(target);
  else fireEvent.keyDown(target, { key: activation });
  await waitFor(() => expect(target.getAttribute("aria-expanded")).toBe("true"));
  expect(target.hasAttribute("aria-pressed")).toBe(false);
  fireEvent.keyDown(target, { key: "Escape" });
  await waitFor(() => expect(target.getAttribute("aria-expanded")).toBe("false"));
  expect(document.activeElement).toBe(target);
  expect(document.querySelector(".inbox")).toBeTruthy();
  fireEvent.click(target.closest("li")!.querySelector(".inbox-actions button")!);
  await waitFor(() => expect(document.querySelector(".inbox")).toBeNull());
  await waitFor(() => expect(document.activeElement?.getAttribute("data-terminal")).toBe("requesting-terminal"));
});

it("u3787c_reopening_resets_Inbox_selection", async () => {
  await mount(inventory[0]!.open);
  fireEvent.click(row("a:a"), { metaKey: true });
  expect(selected()).toEqual(["a:a"]);
  fireEvent.keyDown(row("a:a"), { key: "Escape" });
  expect(selected()).toEqual([]);
  expect(document.querySelector(".inbox")).toBeTruthy();
  fireEvent.click(document.querySelector<HTMLButtonElement>('.overview-section-trigger[aria-expanded="true"]')!);
  inventory[0]!.open();
  await waitFor(() => expect(row("a:a")).toBeTruthy());
  expect(selected()).toEqual([]);
});

// U3742 retains plain-click and comments-read lifetime; these prove keyboard activation.
it.each(["Enter", " "])("u3787c_comment_activation_opens_only_its_Todo_%s", async key => {
  const { app } = await mount(inventory[0]!.open);
  const before = app.calls.length;

  row("c:11").focus();
  expect(row("c:11").hasAttribute("aria-pressed")).toBe(false);
  fireEvent.keyDown(row("c:11"), { key });
  await waitFor(() => expect(document.querySelector(".todo-detail")).not.toBeNull());
  await waitFor(() => expect(app.calls.slice(before).filter(call => call.method === "todo.markCommentsRead").map(call => call.params)).toEqual([{ id: 111 }]));
  expect(app.calls.slice(before).filter(call => call.method === "todo.comments").map(call => call.params)).toEqual([{ id: 111 }]);
  expect(app.calls.slice(before).some(call => call.method.startsWith("agent.") || call.method === "terminal.write")).toBe(false);
});

it("u3787c_selection_can_be_copied_without_opening_or_mutating", async () => {
  const { app } = await mount(inventory[0]!.open);
  const before = app.calls.length;
  fireEvent.click(row("a:a"), { metaKey: true });
  fireEvent.click(row("c:11"), { metaKey: true });
  fireEvent.click(document.querySelector(".inbox .inbox-copy")!);
  await waitFor(() => expect(app.clipboardWrites).toEqual([`alpha\nasks\n\n${copy.inboxRow("alpha", "Ship 11")}\nReply 11`]));
  expect(app.calls.slice(before)).toEqual([]);
  expect(document.querySelector('.inbox [aria-expanded="true"]')).toBeNull();
  expect(document.querySelector(".todo-drawer")).toBeNull();
});
