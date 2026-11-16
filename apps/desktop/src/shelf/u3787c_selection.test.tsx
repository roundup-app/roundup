import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { batch } from "solid-js";
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

// Dispose the App together so each row registration cannot rebuild the native menu during teardown.
afterEach(() => { batch(cleanup); localStorage.clear(); });

const mount = async (entry: typeof inventory[number]) => {
  const app = createFakeApp();
  app.add("/selection");
  Object.assign(app.handlers, todoHandlers({ todos: names.map((title, i) => todo(i + 1, { title })) }, () => {}),
    padHandlers({ pads: names.map((name, i) => ({ ...padOf(name, USER), incarnation: `pad-${i}` })), history: [] }, () => {}));
  render(() => <RequestedApp app={app} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
  await screen.findByRole("tab", { name: "selection" });
  await screen.findByLabelText("Rail", { selector: '[role="tree"]' });
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

  return { rows, app, before };
};

it.each(inventory)("u3787c_each_list_navigates_visible_rows $tab", async entry => {
  const { rows, app, before } = await mount(entry);
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
