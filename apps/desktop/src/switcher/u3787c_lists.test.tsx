import { fireEvent, waitFor } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { mountApp } from "../testing/appFixture";
import { info } from "../testing/nodes";
import { leaderKey } from "../keys/leaderFixture";

// Mounted inventory: one mixed collection, opened from the production App by ⌘K then K.
// Captured actions are commands, not members of the content selection.
const inventory = [{ opening: "⌘K then K", open: () => leaderKey("KeyK") }];
const row = (id: string) => document.querySelector<HTMLElement>(`.switcher [data-value="${id}"]`)!;
const selected = () => [...document.querySelectorAll('.switcher [aria-selected="true"]')].map(element => element.getAttribute("data-value"));
const ids = ["a", "r", "b", "terminal:1", "terminal:2"];

const mount = async (open: () => unknown) => {
  const result = await mountApp(app => {
    app.handlers["terminal.list"] = () => ["Delta", "終 é 😀", "Hidden", "Disabled", "Folded"].map((title, at) => info(String(at + 1), { title, owner: "/p" }));
  });
  open();
  await waitFor(() => expect(document.activeElement).toBe(document.querySelector(".switcher input")));
  row("terminal:3").hidden = true;
  row("terminal:4").setAttribute("aria-disabled", "true");
  row("terminal:5").setAttribute("inert", "");

  return result;
};

it.each(inventory)("u3787c_each_list_navigates_visible_rows $opening", async ({ open }) => {
  const { app } = await mount(open);
  const before = app.calls.length;
  row("b").focus();
  for (const [key, id] of [["Home", "a"], ["ArrowUp", "a"], ["End", "terminal:2"], ["ArrowDown", "terminal:2"], ["ArrowUp", "terminal:1"], ["ArrowDown", "terminal:2"], ["b", "b"]]) {
    fireEvent.keyDown(document.activeElement!, { key });
    expect(document.activeElement).toBe(row(id!));
  }
  expect(selected()).toEqual(["b"]);
  expect(document.querySelector(".drawer")).toBeNull();
  expect(app.calls.slice(before)).toEqual([]);
});

it.each(inventory)("u3787c_each_list_selects_only_visible_rows $opening", async ({ open }) => {
  const { app } = await mount(open);
  const before = app.calls.length;
  fireEvent.click(row("terminal:1"), { shiftKey: true });
  expect(selected()).toEqual(["terminal:1"]);
  fireEvent.click(row("b"), { metaKey: true, shiftKey: true });
  expect(selected()).toEqual(["b"]);
  fireEvent.click(row("r"), { metaKey: true });
  expect(selected()).toEqual(["r", "b"]);
  fireEvent.click(row("terminal:2"), { shiftKey: true });
  expect(selected()).toEqual(["r", "b", "terminal:1", "terminal:2"]);
  fireEvent.click(row("terminal:1"), { metaKey: true });
  expect(selected()).toEqual(["r", "b", "terminal:2"]);
  fireEvent.click(row("terminal:2"), { metaKey: true, shiftKey: true });
  expect(selected()).toEqual(["terminal:1", "terminal:2"]);
  fireEvent.keyDown(document.activeElement!, { key: "a", metaKey: true });
  expect(selected()).toEqual(ids);
  expect(document.querySelector(".drawer")).toBeNull();
  expect(document.querySelector(".rail-row[data-selected=true]")).toBeNull();
  expect(app.calls.slice(before)).toEqual([]);
});
