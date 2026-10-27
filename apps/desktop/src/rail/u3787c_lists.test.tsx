import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { agent, event, terminal, workstream } from "../testing/nodes";
import { todo } from "../todos/testHarness";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(cleanup);

const kinds = [workstream, (id: string) => agent(id, "idle", "ready"), terminal];

// Opening inventory: the open Project mounts Rail; double-click and F2 open each node rename.
it.each(kinds)("u3787c_each_list_selects_only_visible_rows_%#", async make => {
  const { rail, app, connected } = await mountRail(["Alpha", "Beta", "Gamma", "Delta", "終 e\u0301 😀"].map((id, order) => ({ ...make(`row-${order}`), name: id, order })));
  const selected = () => [...document.querySelectorAll<HTMLElement>(".rail-row[data-selected=true]")].map(row => row.querySelector(".name")?.textContent);
  const before = app.calls.length;
  fireEvent.click(rowOf("Beta"), { metaKey: true });
  await waitFor(() => expect(selected()).toEqual(["Beta"]));
  fireEvent.click(rowOf("Delta"), { shiftKey: true });
  await waitFor(() => expect(selected()).toEqual(["Beta", "Gamma", "Delta"]));
  fireEvent.click(rowOf("Gamma"), { metaKey: true });
  await waitFor(() => expect(selected()).toEqual(["Beta", "Delta"]));
  fireEvent.click(rowOf("終 e\u0301 😀"), { metaKey: true, shiftKey: true });
  await waitFor(() => expect(selected()).toEqual(["Gamma", "Delta", "終 e\u0301 😀"]));
  rowOf("Alpha").focus();
  fireEvent.keyDown(rowOf("Alpha"), { key: "a", metaKey: true });
  await waitFor(() => expect(selected()).toHaveLength(5));
  expect(rail.selected()).toBeNull();
  expect(connected.drawer.content()).toBeNull();
  expect(app.calls.slice(before)).toEqual([]);
});

it.each(kinds.flatMap(make => ["F2", "double-click"].map(open => ({ make, open }))))("u3787c_escape_restores_the_name_%#", async ({ make, open }) => {
  const { app, connected } = await mountRail([make("Original")]);
  const row = rowOf("Original");
  row.focus();

  if (open === "F2") fireEvent.keyDown(row, { key: "F2" });
  else fireEvent.dblClick(row);
  const field = screen.getByRole<HTMLInputElement>("textbox", { name: "Name" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.input(field, { target: { value: "  e\u0301 🧭 終  " } });
  const underlying = vi.fn();
  document.addEventListener("keydown", underlying);

  try { fireEvent.keyDown(field, { key: "Escape" }); }
  finally { document.removeEventListener("keydown", underlying); }

  await waitFor(() => expect(document.activeElement).toBe(rowOf("Original")));
  expect(underlying).not.toHaveBeenCalled();
  expect(railCallsTo(app, "rail.rename")).toEqual([]);
  expect(connected.drafts.list().map(draft => draft.value.text)).toEqual(["  e\u0301 🧭 終  "]);
  fireEvent.keyDown(rowOf("Original"), { key: "F2" });
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Name" }).value).toBe("  e\u0301 🧭 終  ");
});

it.each(kinds)("u3787c_each_list_navigates_visible_rows_%#", async make => {
  await mountRail(["Alpha", "Beta", "Gamma", "Delta", "終 e\u0301 😀"].map((name, order) => ({ ...make(`row-${order}`), name, order })));

  const press = async (name: string, key: string, expected: string) => {
    rowOf(name).focus();
    fireEvent.keyDown(rowOf(name), { key });
    await waitFor(() => expect(document.activeElement).toBe(rowOf(expected)));
  };

  await press("Gamma", "Home", "Alpha");
  await press("Alpha", "ArrowUp", "Alpha");
  await press("Alpha", "End", "終 e\u0301 😀");
  await press("終 e\u0301 😀", "ArrowDown", "終 e\u0301 😀");
  await press("終 e\u0301 😀", "ArrowUp", "Delta");
  await press("Delta", "ArrowDown", "終 e\u0301 😀");
  await press("終 e\u0301 😀", "B", "Beta");
  expect(rowOf("Beta").getAttribute("data-selected")).toBe("true");
});

it("u3787c_agent_pad_inventory_opens_the_owner_disclosure", async () => {
  const names = ["Alpha", "Beta", "Gamma", "Delta", "終 e\u0301 😀"];

  const { app, connected } = await mountRail([agent("owner", "idle", "ready")], [], undefined, undefined, {}, names.map((name, index) => ({
    incarnation: `pad-${index}`, name, owner: { kind: "agent", id: "owner", parent: null }, home: null, text: "saved", revision: 1, updated_at: 0,
  })));

  fireEvent.click(await screen.findByRole("button", { name: "5 pads" }));
  const rows = () => [...document.querySelectorAll<HTMLButtonElement>(".rail-pad")];
  await waitFor(() => expect(rows()).toHaveLength(5));
  const before = app.calls.length;
  rows()[2]!.focus();
  fireEvent.keyDown(rows()[2]!, { key: "Home" });
  expect(document.activeElement).toBe(rows()[0]);
  fireEvent.keyDown(rows()[0]!, { key: "End" });
  expect(document.activeElement).toBe(rows()[4]);
  fireEvent.keyDown(rows()[4]!, { key: "ArrowDown" });
  expect(document.activeElement).toBe(rows()[4]);
  fireEvent.keyDown(rows()[4]!, { key: "B" });
  expect(document.activeElement).toBe(rows()[1]);
  fireEvent.click(rows()[1]!, { metaKey: true });
  fireEvent.click(rows()[3]!, { shiftKey: true });
  expect(rows().map(row => row.getAttribute("aria-pressed"))).toEqual(["false", "true", "true", "true", "false"]);
  fireEvent.keyDown(rows()[3]!, { key: "a", metaKey: true });
  expect(rows().filter(row => row.getAttribute("aria-pressed") === "true")).toHaveLength(5);
  expect(connected.drawer.content()).toBeNull();
  expect(app.calls.slice(before)).toEqual([]);
});


it.each(["F2", "double-click"])("u3787c_escape_restores_the_name_owned_todo_%s", async opening => {
  const { app, connected } = await mountRail([agent("owner", "idle", "ready")]);
  app.handlers["todo.list"] = () => [todo(1, { title: "Original", creator: { kind: "agent", id: "owner", parent: null } })];
  app.emit(event({ name: "todo.created", data: todo(1) }));
  fireEvent.click(await screen.findByRole("button", { name: "1 todos" }));
  const row = await screen.findByRole<HTMLButtonElement>("button", { name: /Original/ });
  row.focus();

  if (opening === "F2") fireEvent.keyDown(row, { key: "F2" });
  else fireEvent.dblClick(row);
  const field = screen.getByRole<HTMLInputElement>("textbox", { name: "Name" });
  await waitFor(() => expect(document.activeElement).toBe(field));
  fireEvent.input(field, { target: { value: "  e\u0301 🧭 終  " } });
  const underlying = vi.fn();
  document.addEventListener("keydown", underlying);

  try { fireEvent.keyDown(field, { key: "Escape" }); }
  finally { document.removeEventListener("keydown", underlying); }

  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: row.getAttribute("aria-label")! })));
  expect(underlying).not.toHaveBeenCalled();
  expect(railCallsTo(app, "todo.update")).toEqual([]);
  expect(connected.drafts.list().map(draft => draft.value.text)).toEqual(["  e\u0301 🧭 終  "]);
});

it("u3787c_ranges_have_no_implicit_anchor_and_skip_folded_rows", async () => {
  await mountRail([workstream("group"), agent("hidden", "idle", "ready", { parent: "group" }), ...["Alpha", "Beta", "Gamma", "Delta", "End"].map((name, order) => agent(`node-${order}`, "idle", "ready", { name, order: order + 1 }))]);
  fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
  await waitFor(() => expect(document.querySelector('.rail-row[data-id="hidden"]')).toBeNull());
  fireEvent.click(rowOf("Gamma"), { shiftKey: true });
  expect([...document.querySelectorAll(".rail-row[data-selected=true] .name")].map(row => row.textContent)).toEqual(["Gamma"]);
  fireEvent.keyDown(rowOf("Gamma"), { key: "a", metaKey: true });
  expect([...document.querySelectorAll(".rail-row[data-selected=true] .name")].map(row => row.textContent)).toEqual(["group", "Alpha", "Beta", "Gamma", "Delta", "End"]);
});

it.each(kinds)("u3787c_navigation_and_selection_skip_ineligible_rows_%#", async make => {
  await mountRail(["Alpha", "Hidden", "Disabled", "Beta"].map((name, order) => ({ ...make(`row-${order}`), name, order })));
  rowOf("Hidden").hidden = true;
  rowOf("Disabled").setAttribute("aria-disabled", "true");
  rowOf("Alpha").focus();
  fireEvent.keyDown(rowOf("Alpha"), { key: "H" });
  expect(document.activeElement).toBe(rowOf("Alpha"));
  fireEvent.keyDown(rowOf("Alpha"), { key: "ArrowDown" });
  await waitFor(() => expect(document.activeElement).toBe(rowOf("Beta")));
  fireEvent.keyDown(rowOf("Beta"), { key: "a", metaKey: true });
  expect([...document.querySelectorAll(".rail-row[data-selected=true] .name")].map(row => row.textContent)).toEqual(["Alpha", "Beta"]);
});
