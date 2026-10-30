import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it } from "vitest";
import { App } from "../App";
import { copy } from "../copy";
import { createFakeApp } from "../testing/fakeApp";
import { openProjectPage } from "../testing/menuProbe";
import { agent, workstream } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import type { Deliverable } from "@contracts/deliverable/Deliverable";

afterEach(cleanup);

beforeEach(() => localStorage.clear());

const names = ["alpha", "same é 🧭", "same é 🧭", "delta", "終 é 🧭", "hidden", "disabled", "folded"];

const published = (title: string, at: number): Deliverable => ({
  id: `record-${at}`, project: "original-project", maker: { kind: "agent", id: "maker", parent: null }, maker_name: "Maker", home: "home",
  title, published_at: 1792713600000, target: { kind: "external", availability: "not-checked", url: `https://example.com/${at}` },
});

const inventory = [
  { opening: "Project → Needs you", selector: ".overview-entry", command: null },
  { opening: "Project → requested Workstreams overview", selector: ".overview-entry", command: "view:workstreams" },
  { opening: "Project menu → Made", selector: ".made-open", command: "view:made" },
];

const mount = async (command: string | null, selector: string) => {
  const app = createFakeApp();
  app.opened.project = { path: "/p", name: "Project" };
  app.handlers["rail.tree"] = () => [workstream("home", { name: "Home", status: null }), ...names.map((name, at) => agent(`node-${at}`, "needs-you", "asks", { name, parent: "home", order: at }))];
  app.handlers["terminal.list"] = () => [];
  app.handlers["deliverable.list"] = () => names.map(published);
  app.handlers["deliverable.resolve"] = ({ id }) => ({ kind: "external", availability: "not-checked", url: `https://example.com/${id}` });
  const { factory } = fakeEmulators();
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={factory} prepareIdle={open => { if (command === "view:workstreams") open.showView("workstreams"); }} />);
  await screen.findByRole("region", { name: "Project overview" });

  if (command === "view:made") openProjectPage(command, "/p");
  await waitFor(() => expect(document.querySelectorAll(selector).length).toBe(command === "view:workstreams" ? 9 : 8));
  const rows = [...document.querySelectorAll<HTMLButtonElement>(selector)];
  // Nested attention rows remain eligible even when their Rail Home is collapsed.
  const eligible = rows.slice(0, -3);
  rows.at(-3)!.hidden = true;
  rows.at(-2)!.disabled = true;
  rows.at(-1)!.closest("li")!.setAttribute("inert", "");

  return { app, rows, eligible };
};

const selected = (rows: HTMLButtonElement[]) => rows.filter(row => row.dataset.rowSelected === "true");

it.each(inventory)("u3787c_each_list_navigates_visible_rows $opening", async ({ command, selector }) => {
  const { app, rows, eligible } = await mount(command, selector);
  const before = app.calls.length;
  eligible[1]!.focus();

  for (const [key, at] of [["Home", 0], ["ArrowUp", 0], ["End", eligible.length - 1], ["ArrowDown", eligible.length - 1], ["ArrowUp", eligible.length - 2], ["ArrowDown", eligible.length - 1], ["a", command === "view:workstreams" ? 1 : 0], ["l", command === "view:workstreams" ? 1 : 0]] as const) {
    fireEvent.keyDown(document.activeElement!, { key });
    expect(document.activeElement).toBe(eligible[at]);
  }

  expect(selected(rows)).toEqual([eligible[command === "view:workstreams" ? 1 : 0]]);
  expect(app.calls.slice(before)).toEqual([]);
  expect(document.querySelector(".todo-drawer, .rail-row[data-selected=true]")).toBeNull();
});

it.each(inventory)("u3787c_each_list_selects_only_visible_rows $opening", async ({ command, selector }) => {
  const { app, rows, eligible: r } = await mount(command, selector);
  const before = app.calls.length;
  fireEvent.click(r[1]!, { shiftKey: true });
  expect(selected(rows)).toEqual([r[1]]);
  fireEvent.click(r[4]!, { metaKey: true, shiftKey: true });
  expect(selected(rows)).toEqual([r[4]]);
  fireEvent.click(r[1]!, { metaKey: true });
  expect(selected(rows)).toEqual([r[1], r[4]]);
  fireEvent.click(r[3]!, { shiftKey: true });
  expect(selected(rows)).toEqual([r[1], r[2], r[3]]);
  fireEvent.click(r[2]!, { metaKey: true });
  expect(selected(rows)).toEqual([r[1], r[3]]);
  fireEvent.click(r[4]!, { metaKey: true, shiftKey: true });
  expect(selected(rows)).toEqual([r[2], r[3], r[4]]);
  fireEvent.keyDown(r[4]!, { key: "a", metaKey: true });
  expect(selected(rows)).toEqual(r);
  r[1]!.hidden = true;
  fireEvent.keyDown(r[4]!, { key: "a", metaKey: true });
  expect(selected(rows)).toEqual(r.filter((_, at) => at !== 1));
  expect(app.calls.slice(before)).toEqual([]);
  expect(document.querySelector(".todo-drawer, .rail-row[data-selected=true]")).toBeNull();
  expect(app.openedTargets).toEqual([]);
});

it.each(["Enter", " "])("u3787c_Made_activation_resolves_the_original_identity_%s", async key => {
  const { app, eligible } = await mount("view:made", ".made-open");
  eligible[2]!.focus();
  fireEvent.keyDown(eligible[2]!, { key });
  await waitFor(() => expect(app.openedTargets).toEqual([{ kind: "url", url: "https://example.com/record-2" }]));
  expect(app.calls.filter(call => call.method === "deliverable.resolve").map(call => call.params)).toEqual([{ project: "original-project", id: "record-2" }]);
});

// U2567c retains pointer activation; these exercise the added collection key ownership.
it.each(["Enter", " "])("u3787c_overview_activation_selects_only_the_original_attention_%s", async key => {
  const { app, eligible } = await mount(null, ".overview-entry");
  const before = app.calls.length;
  eligible[2]!.focus();
  fireEvent.keyDown(eligible[2]!, { key });
  await waitFor(() => expect(document.querySelector('.rail-row[data-id="node-2"][data-selected=true]')).not.toBeNull());
  expect(app.calls.slice(before).some(call => ["agent.spawn", "terminal.write", "ask.send"].includes(call.method))).toBe(false);
});

it.each(inventory)("u3787c_reopening_keeps_the_existing_list_lifetime $opening", async ({ command, selector }) => {
  const { app, rows } = await mount(command, selector);
  fireEvent.click(rows[1]!, { metaKey: true });
  expect(selected(rows)).toEqual([rows[1]]);

  if (command !== "view:made") openProjectPage("view:made", "/p");
  await screen.findByRole("region", { name: copy.deliverables });
  await waitFor(() => expect(screen.queryByRole("region", { name: copy.projectOverview })).toBeNull());
  const madeHeading = screen.getByRole("button", { name: copy.deliverables });
  madeHeading.focus();
  await waitFor(() => expect(madeHeading.hasAttribute("data-focus")).toBe(true));
  fireEvent.click(madeHeading);
  await waitFor(() => expect(screen.queryByRole("region", { name: copy.deliverables })).toBeNull());

  if (command === "view:made") openProjectPage(command, "/p");
  else {
    const heading = screen.getByRole("button", { name: copy.needsYou });
    heading.focus();
    await waitFor(() => expect(heading.hasAttribute("data-focus")).toBe(true));
    fireEvent.click(heading);
  }
  await waitFor(() => expect(document.querySelectorAll(selector).length).toBe(command === "view:workstreams" ? 9 : 8));
  expect(selected([...document.querySelectorAll<HTMLButtonElement>(selector)]).map(row => row.textContent)).toEqual([rows[1]!.textContent]);
  expect(app.openedTargets).toEqual([]);
});
