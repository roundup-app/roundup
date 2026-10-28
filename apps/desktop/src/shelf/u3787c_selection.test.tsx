import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RequestedApp } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import { todoHandlers, padHandlers } from "../testing/stores";
import { todo } from "../todos/testHarness";
import { padOf } from "../pads/padsFixture";
import { USER } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import { showEverythingInApp } from "../testing/showEverything";
import { showShelfTab } from "../testing/shelfTabs";

// Mounted inventory: Project → Work items tab → Unassigned disclosure → row.
const inventory = [
  { tab: "Todos", selector: ".todo-row-button" },
  { tab: "Pads", selector: ".pad-name" },
] as const;

const names = ["Alpha", "長い名前 é 🧭 ".repeat(10), "same", "same", "Éclair", "Zulu", "hidden", "disabled"];

afterEach(() => { cleanup(); localStorage.clear(); });

const mount = async (entry: typeof inventory[number], titles = names) => {
  const app = createFakeApp();
  app.add("/selection");
  Object.assign(app.handlers, todoHandlers({ todos: titles.map((title, i) => todo(i + 1, { title })) }, () => {}),
    padHandlers({ pads: titles.map((name, i) => ({ ...padOf(name, USER), incarnation: `pad-${i}` })), history: [] }, () => {}));
  render(() => <RequestedApp app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  await screen.findByRole("tab", { name: "selection" });
  await screen.findByRole("textbox", { name: "Ask" });
  await showEverythingInApp();
  showShelfTab(entry.tab);

  const group = await waitFor(() => {
    const row = document.querySelector<HTMLElement>(`${entry.tab === "Todos" ? ".todos-tab" : ".pads-tab"} [data-shelf-group="unassigned"] [data-part="branch-control"]`);
    expect(row).not.toBeNull();

    return row!;
  });

  if (group.closest('[data-shelf-group]')?.getAttribute('aria-expanded') === 'false') fireEvent.click(group);

  const rows = await waitFor(() => {
    const rows = [...document.querySelectorAll<HTMLButtonElement>(`.shelf ${entry.selector}`)];
    expect(rows).toHaveLength(8);

    return rows;
  });

  rows[6]!.hidden = true;
  rows[7]!.disabled = true;
  const before = app.calls.length;

  const rowFor = (index: number) => rows.find(row => entry.tab === "Todos"
    ? row.closest("[data-todo]")?.getAttribute("data-todo") === String(index + 1)
    : row.closest("[data-incarnation]")?.getAttribute("data-incarnation") === `pad-${index}`)!;

  return { rows, app, before, rowFor };
};

it.each(inventory)("u3787c_each_list_navigates_visible_rows $tab", async entry => {
  const { rows, app, before, rowFor } = await mount(entry);
  // DOM order, rather than fixture insertion order, is the visible list order.
  const eligible = rows.filter(row => !row.hidden && !row.disabled);
  const first = eligible[0]!;
  const last = eligible.at(-1)!;
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowUp" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "End" });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: "ArrowDown" });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: "Home" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(document.activeElement).toBe(eligible[1]);
  fireEvent.keyDown(eligible[1]!, { key: "ArrowUp" });
  expect(document.activeElement).toBe(first);
  const match = rowFor(4);
  fireEvent.keyDown(first, { key: "É" });
  expect(document.activeElement).toBe(match);
  expect(match.getAttribute("aria-pressed")).toBe("true");
  expect(document.querySelector('.drawer[data-open="true"]')).toBeNull();
  expect(app.calls.slice(before)).toEqual([]);
});

it.each(inventory)("u3787c_each_list_selects_only_visible_rows $tab", async entry => {
  const { rows, app, before } = await mount(entry);
  const eligible = rows.filter(row => !row.hidden && !row.disabled);
  const selected = () => rows.filter(row => row.getAttribute("aria-pressed") === "true");
  fireEvent.click(eligible[2]!, { shiftKey: true });
  expect(selected()).toEqual([eligible[2]]);
  fireEvent.click(eligible[0]!, { metaKey: true });
  expect(selected()).toEqual([eligible[0], eligible[2]]);
  fireEvent.click(eligible[0]!, { metaKey: true });
  expect(selected()).toEqual([eligible[2]]);
  fireEvent.click(eligible[3]!, { metaKey: true, shiftKey: true });
  expect(selected()).toEqual(eligible.slice(0, 4));
  fireEvent.click(eligible[1]!, { shiftKey: true });
  expect(selected()).toEqual(eligible.slice(0, 2));
  eligible[0]!.focus();
  fireEvent.keyDown(eligible[0]!, { key: "a", metaKey: true });
  expect(selected()).toEqual(eligible);
  expect(document.querySelector('.drawer[data-open="true"]')).toBeNull();
  expect(app.calls.slice(before)).toEqual([]);
});

// These letters also own Shelf commands; a matching name owns the press first.
it.each(inventory.flatMap(entry => ["d", "e", "m", "o", "t", "1"].map(prefix => ({ ...entry, prefix }))))("u3787c_name_prefix_precedes_commands $tab $prefix", async entry => {
  const { prefix } = entry;
  const { rows, app, before, rowFor } = await mount(entry, ["Alpha", `${prefix}example`, "same", "same", "Éclair", "Zulu", "hidden", "disabled"]);
  rows[0]!.focus();
  fireEvent.keyDown(rows[0]!, { key: prefix, code: /^\d$/.test(prefix) ? `Digit${prefix}` : `Key${prefix.toUpperCase()}` });
  const match = rowFor(1);
  expect(document.activeElement).toBe(match);
  expect(match.getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(match, { key: "e", code: "KeyE" });
  expect(document.activeElement).toBe(match);
  expect(app.calls.slice(before)).toEqual([]);
  expect(app.chooser.suggestedNames).toEqual([]);
});
