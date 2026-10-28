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

const mount = async (open: () => boolean) => {
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
  expect(document.querySelector('.drawer[data-open="true"]')).toBeNull();
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
  expect(document.querySelector('.switcher [role="listbox"]')?.getAttribute("aria-multiselectable")).toBe("true");
  expect(document.querySelector('.drawer[data-open="true"]')).toBeNull();
  expect(document.querySelector(".rail-row[data-selected=true]")).toBeNull();
  expect(app.calls.slice(before)).toEqual([]);
});


it.each(["Enter", " ", "click"])("u3787c_content_activation_preserves_the_chosen_Terminal_%s", async activation => {
  await mount(inventory[0]!.open);
  const target = row("terminal:1");
  target.focus();

  if (activation === "click") fireEvent.click(target);
  else fireEvent.keyDown(target, { key: activation });

  await waitFor(() => expect(document.querySelector(".switcher")).toBeNull());
  await waitFor(() => expect(document.activeElement?.closest("[data-bubble]")?.getAttribute("data-bubble")).toBe("1"));
});

it("u3787c_filter_and_reopening_preserve_query_and_reset_content_selection", async () => {
  const { app } = await mount(inventory[0]!.open);
  fireEvent.click(row("r"), { metaKey: true });
  const input = document.querySelector<HTMLInputElement>(".switcher input")!;
  input.focus();
  fireEvent.input(input, { target: { value: "Delta" } });
  input.setSelectionRange(1, 4, "backward");
  fireEvent.click(row("terminal:1"), { shiftKey: true });
  expect(selected()).toEqual(["terminal:1"]);
  const before = app.calls.length;
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(document.querySelector(".switcher")).toBeNull());
  inventory[0]!.open();
  await waitFor(() => expect(document.activeElement).toBe(document.querySelector(".switcher input")));
  const restored = document.querySelector<HTMLInputElement>(".switcher input")!;
  // Focus precedes the native select event that restores the retained query selection.
  await waitFor(() => expect([restored.value, restored.selectionStart, restored.selectionEnd, restored.selectionDirection]).toEqual(["Delta", 1, 4, "backward"]));
  expect(selected()).toEqual([]);
  expect(app.calls.slice(before)).toEqual([]);
});


it("u3787c_query_Home_End_keep_native_editing_without_row_selection", async () => {
  await mount(inventory[0]!.open);
  const input = document.querySelector<HTMLInputElement>(".switcher input")!;

  fireEvent.input(input, { target: { value: "Delta" } });
  input.setSelectionRange(1, 4, "backward");

  for (const key of ["Home", "End"]) {
    expect(fireEvent.keyDown(input, { key })).toBe(true);
  }

  expect(selected()).toEqual([]);
  expect(input.value).toBe("Delta");
});
