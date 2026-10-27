import { fireEvent, waitFor } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { mountApp } from "../testing/appFixture";
import { agent, info } from "../testing/nodes";
import { leaderKey } from "../keys/leaderFixture";

// Mounted inventory: Inbox is one mixed content collection, in section order.
// Open/Retry/Dismiss and the comments-read recovery action are not content rows.
const inventory = [{ opening: "⌘K then I", open: () => leaderKey("KeyI") }];
const row = (id: string) => document.querySelector<HTMLElement>(`.inbox [data-collection-value="${id}"]`)!;
const selected = () => [...document.querySelectorAll('.inbox [aria-selected="true"]')].map(el => el.getAttribute("data-collection-value"));
const ids = ["a:a", "c:11", "c:12", "a:r", "a:b"];

const mount = async (open: () => boolean) => {
  const result = await mountApp(app => {
    app.handlers["rail.tree"] = () => [agent("a", "needs-you", "asks", { name: "alpha" }), agent("r", "working", "editing", { name: "running" }), agent("b", "done", "finished", { name: "終 é 😀" })];
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
  expect(document.querySelector('.inbox [aria-expanded="true"]')).toBeNull();
  expect(document.querySelector('.rail-row[data-selected=true]')).toBeNull();
  expect(app.calls.slice(before)).toEqual([]);
  expect([...document.querySelectorAll('.inbox .inbox-actions button, .inbox .reserved-actions button')].every(el => !el.hasAttribute("data-collection-value"))).toBe(true);
});

it.each(["Enter", " ", "click"])("u3787c_agent_activation_and_Escape_preserve_the_requesting_Terminal_%s", async activation => {
  await mount(inventory[0]!.open);
  const target = row("a:a");
  target.focus();
  if (activation === "click") fireEvent.click(target);
  else fireEvent.keyDown(target, { key: activation });
  await waitFor(() => expect(target.getAttribute("aria-expanded")).toBe("true"));
  fireEvent.keyDown(target, { key: "Escape" });
  await waitFor(() => expect(target.getAttribute("aria-expanded")).toBe("false"));
  expect(document.activeElement).toBe(target);
  expect(document.querySelector(".inbox")).toBeTruthy();
  fireEvent.click(target.closest("li")!.querySelector(".inbox-actions button")!);
  await waitFor(() => expect(document.querySelector(".inbox")).toBeNull());
  await waitFor(() => expect(document.activeElement?.closest("[data-bubble]")?.getAttribute("data-bubble")).toBe("requesting-terminal"));
});

it("u3787c_reopening_resets_Inbox_selection", async () => {
  await mount(inventory[0]!.open);
  fireEvent.click(row("a:a"), { metaKey: true });
  expect(selected()).toEqual(["a:a"]);
  fireEvent.keyDown(row("a:a"), { key: "Escape" });
  await waitFor(() => expect(document.querySelector(".inbox")).toBeNull());
  inventory[0]!.open();
  await waitFor(() => expect(row("a:a")).toBeTruthy());
  expect(selected()).toEqual([]);
});
