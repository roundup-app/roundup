import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { renderTabs, path } from "../header/stripFixture";
import { agent, door, workstream, USER } from "./nodes";
import { padHandlers, todoHandlers } from "./stores";
import { padOf } from "../pads/padsFixture";
import { todo } from "../todos/testHarness";
import { captureActions } from "../keys/registry";
import { openProjectPage } from "./menuProbe";
import { showShelfTab } from "./shelfTabs";
import { settled } from "../rail/railFixture";

// Final App inventory: Todo creator controls and shared Pad Home groups use the Shelf holder.
const shelf = ["Todos", "Pads"] as const;

const names = ["Alpha", "Bravo", "Charlie", "Delta", "Éclair"];

const owner = { kind: "agent", id: "a", parent: null } as const;

afterEach(() => { cleanup(); localStorage.clear(); });

const openShelf = async (tab: typeof shelf[number]) => {
  const { app } = renderTabs({ p: [agent("a", "idle", "ready", { name: "owner" })] });
  const daemon = app.of(path("p"));
  Object.assign(daemon.handlers, tab === "Todos"
    ? todoHandlers({ todos: names.map((title, i) => todo(i + 1, { title, creator: owner })) }, () => {})
    : padHandlers({ pads: names.map(name => padOf(name, USER)), history: [] }, () => {}));
  await screen.findByRole("textbox", { name: "Ask" });
  openProjectPage("view:workstreams", path("p"));

  if (tab === "Todos") {
    const control = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-id="a"] [data-pads-control]');
      expect(found).not.toBeNull();

      return found!;
    });

    fireEvent.click(control);
  } else {
    showShelfTab("Pads");

    const group = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.pads-tab [data-shelf-group="unassigned"]');
      expect(found).not.toBeNull();

      return found!;
    });

    if (group.getAttribute("aria-expanded") === "false") fireEvent.click(group.querySelector(".shelf-group-control")!);
  }

  const rows = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(tab === "Todos" ? ".shelf .todo-row-button" : ".shelf .pad-name")];
    expect(found).toHaveLength(5);

    return found;
  });

  await settled();

  return { app: daemon, rows };
};

it.each(shelf)("u3787c_each_list_navigates_visible_rows Shelf navigation %s", async tab => {
  const { app, rows } = await openShelf(tab);
  const before = app.calls.length;
  rows[0]!.focus();

  for (const [key, at] of [["ArrowUp", 0], ["ArrowDown", 1], ["ArrowUp", 0], ["End", 4], ["ArrowDown", 4], ["Home", 0], ["É", 4]] as const) {
    fireEvent.keyDown(document.activeElement!, { key });
    await settled();
    expect(document.activeElement).toBe(rows[at]);
  }

  expect(document.querySelector('.drawer[data-open="true"]')).toBeNull();
  expect(app.calls.slice(before)).toEqual([]);
});

it.each(shelf)("u3787c_each_list_selects_only_visible_rows Shelf navigation %s", async tab => {
  const { app, rows } = await openShelf(tab);
  const before = app.calls.length;
  const selected = () => rows.filter(row => row.getAttribute("aria-pressed") === "true");

  for (const [at, metaKey, shiftKey, expected] of [[2, false, true, [2]], [0, true, false, [0, 2]], [0, true, false, [2]], [3, true, true, [0, 1, 2, 3]], [1, false, true, [0, 1]]] as const) {
    fireEvent.click(rows[at]!, { metaKey, shiftKey });
    await settled();
    expect(selected()).toEqual(expected.map(index => rows[index]));
  }

  rows[0]!.focus();
  fireEvent.keyDown(rows[0]!, { key: "a", metaKey: true });
  await settled();
  expect(selected()).toEqual(rows);
  expect(document.querySelector('.drawer[data-open="true"]')).toBeNull();
  expect(app.calls.slice(before)).toEqual([]);
});

// Full App, rather than WorktreeControl alone: both production openings reach the shadow tree.
const files = names.map((_, i) => ({ path: `${["alpha", "bravo", "charlie", "delta", "echo"][i]}.ts`, status: "modified" as const, line: i + 1 }));

const shadow = () => document.querySelector("file-tree-container")?.shadowRoot;

const changedRows = () => [...(shadow()?.querySelectorAll<HTMLElement>("[data-item-path]") ?? [])];

const openChanges = async (opening: string) => {
  const { app } = renderTabs({ p: [agent("a", "idle", "ready", { worktree: { path: "/p/work", branch: "work", base: "main" } })] });
  const daemon = app.of(path("p"));
  daemon.handlers["agent.worktreeState"] = () => ({ ahead: 0, behind: 0, dirty: true });
  daemon.handlers["agent.changedFiles"] = () => ({ files });
  await screen.findByRole("textbox", { name: "Ask" });
  openProjectPage("view:workstreams", path("p"));

  const row = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('.rail-row[data-id="a"]');
    expect(found).not.toBeNull();

    return found!;
  });

  fireEvent.click(row);
  const control = await screen.findByRole("button", { name: "5 changed files" });
  await settled();

  if (opening === "counted control") fireEvent.click(control);
  else {
    row.focus();
    const action = captureActions(row).find(action => action.value === "action:leader:C");
    expect(action).toBeDefined();
    action!.run();
  }

  await waitFor(() => expect(changedRows()).toHaveLength(5));
  await waitFor(() => expect(shadow()?.activeElement).not.toBeNull());
  await settled();

  return { app: daemon, rows: changedRows() };
};

it.each(["counted control", "Review changes"])("u3787c_each_list_navigates_visible_rows App changes %s", async opening => {
  const { app, rows } = await openChanges(opening);
  const before = app.calls.length;
  rows[0]!.focus();

  for (const [key, at] of [["ArrowUp", 0], ["ArrowDown", 1], ["ArrowUp", 0], ["End", 4], ["ArrowDown", 4], ["Home", 0], ["c", 2]] as const) {
    fireEvent.keyDown(shadow()!.activeElement!, { key, composed: true });
    await settled();
    expect(shadow()?.activeElement).toBe(rows[at]);
  }

  expect(document.querySelector(".diff-reader")).toBeNull();
  expect(app.calls.slice(before)).toEqual([]);
});

it.each(["counted control", "Review changes"])("u3787c_each_list_selects_only_visible_rows App changes %s", async opening => {
  const { app, rows } = await openChanges(opening);
  const before = app.calls.length;
  const selected = () => rows.filter(row => row.getAttribute("aria-selected") === "true");

  for (const [at, metaKey, shiftKey, expected] of [[2, false, true, [2]], [0, true, false, [0, 2]], [0, true, false, [2]], [3, true, true, [0, 1, 2, 3]], [1, false, true, [0, 1]]] as const) {
    fireEvent.click(rows[at]!, { metaKey, shiftKey, composed: true });
    await settled();
    expect(selected()).toEqual(expected.map(index => rows[index]));
  }

  rows[0]!.focus();
  fireEvent.keyDown(rows[0]!, { key: "a", metaKey: true, composed: true });
  await settled();
  expect(selected()).toEqual(rows);
  expect(document.querySelector(".diff-reader")).toBeNull();
  expect(app.calls.slice(before)).toEqual([]);
});

const renames = ["Todo", "Pad", "Workstream", "Agent"] as const;

it.each(renames.flatMap(kind => (kind === "Todo" || kind === "Pad" ? ["F2", "native Rename"] : ["native Rename"]).map(opening => ({ kind, opening }))))("u3787c_escape_restores_the_name App $kind $opening", async ({ kind, opening }) => {
  const node = kind === "Workstream" ? door("a", "idle", "ready", { name: "Original" }) : agent("a", "idle", "ready", { name: "Original" });
  const { app } = renderTabs({ p: [node] });
  const daemon = app.of(path("p"));
  Object.assign(daemon.handlers, todoHandlers({ todos: [todo(1, { title: "Original" })] }, () => {}), padHandlers({ pads: [padOf("Original", USER)], history: [] }, () => {}));
  await screen.findByRole("textbox", { name: "Ask" });
  openProjectPage("view:workstreams", path("p"));
  await waitFor(() => expect(document.querySelector('.rail-row[data-id="a"]')).not.toBeNull());

  if (kind === "Todo" || kind === "Pad") {
    showShelfTab(kind === "Todo" ? "Todos" : "Pads");

    const group = await waitFor(() => {
      const found = document.querySelector<HTMLElement>(`${kind === "Todo" ? ".todos-tab" : ".pads-tab"} [data-shelf-group="unassigned"] .shelf-group-control`);
      expect(found).not.toBeNull();

      return found!;
    });

    if (group.closest("[data-shelf-group]")?.getAttribute("aria-expanded") !== "true") fireEvent.click(group);
    await waitFor(() => expect(group.closest("[data-shelf-group]")?.getAttribute("aria-expanded")).toBe("true"));
    await settled();
  }

  const selector = kind === "Todo" ? '.shelf [data-todo="1"] .todo-row-button' : kind === "Pad" ? '.shelf [data-pad="Original"] .pad-name' : '.rail-row[data-id="a"]';

  const row = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(selector);
    expect(found).not.toBeNull();

    return found!;
  });

  const savedName = row.textContent;

  row.focus();
  await settled();

  if (opening === "native Rename") { fireEvent.contextMenu(row); await app.pickMenu("Rename"); }
  else fireEvent.keyDown(row, { key: "F2" });
  const field = await screen.findByRole<HTMLInputElement>("textbox", { name: "Name" });
  const text = "  e\u0301 🧭 日本語  ";
  fireEvent.input(field, { target: { value: text } });
  const underlying = vi.fn();
  document.addEventListener("keydown", underlying);

  try { fireEvent.keyDown(field, { key: "Escape" }); }
  finally { document.removeEventListener("keydown", underlying); }

  await waitFor(() => expect(document.activeElement).toBe(document.querySelector(selector)));
  expect(document.querySelector(selector)?.textContent).toBe(savedName);
  expect(underlying).not.toHaveBeenCalled();
  expect(daemon.calls.filter(call => ["rail.rename", "todo.update", "pad.rename", "terminal.write"].includes(call.method))).toEqual([]);
  fireEvent.keyDown(document.activeElement!, { key: "F2" });
  expect((await screen.findByRole<HTMLInputElement>("textbox", { name: "Name" })).value).toBe(text);
});

it.each([workstream, (id: string) => agent(id, "idle", "ready")])("u3787c_each_list_navigates_visible_rows App Rail %#", async make => {
  renderTabs({ p: names.map((name, order) => ({ ...make(`row-${order}`), name, order })) });
  await screen.findByRole("textbox", { name: "Ask" });
  openProjectPage("view:workstreams", path("p"));

  const rows = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".rail-row")];
    expect(found).toHaveLength(5);

    return found;
  });

  const heading = screen.getByRole("tree", { name: "Rail" }).querySelector(".section-head");
  rows[2]!.focus();

  for (const [key, target] of [["Home", heading], ["ArrowUp", heading], ["ArrowDown", rows[0]], ["ArrowDown", rows[1]], ["ArrowUp", rows[0]], ["End", rows[4]], ["ArrowDown", rows[4]], ["B", rows[1]]] as const) {
    fireEvent.keyDown(document.activeElement!, { key });
    await settled();
    expect(document.activeElement).toBe(target);
  }
});

it.each([workstream, (id: string) => agent(id, "idle", "ready")])("u3787c_each_list_selects_only_visible_rows App Rail %#", async make => {
  const { app } = renderTabs({ p: names.map((name, order) => ({ ...make(`row-${order}`), name, order })) });
  await screen.findByRole("textbox", { name: "Ask" });
  openProjectPage("view:workstreams", path("p"));

  const rows = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".rail-row")];
    expect(found).toHaveLength(5);

    return found;
  });

  await settled();
  const daemon = app.of(path("p"));
  const before = daemon.calls.length;
  const selected = () => rows.filter(row => row.getAttribute("data-selected") === "true");

  for (const [at, metaKey, shiftKey, expected] of [[2, false, true, [2]], [0, true, false, [0, 2]], [0, true, false, [2]], [3, true, true, [0, 1, 2, 3]], [1, false, true, [0, 1]]] as const) {
    fireEvent.click(rows[at]!, { metaKey, shiftKey });
    await settled();
    expect(selected()).toEqual(expected.map(index => rows[index]));
  }

  rows[0]!.focus();
  fireEvent.keyDown(rows[0]!, { key: "a", metaKey: true });
  await settled();
  expect(selected()).toEqual(rows);
  expect(document.querySelector('.drawer[data-open="true"]')).toBeNull();
  expect(daemon.calls.slice(before)).toEqual([]);
});
