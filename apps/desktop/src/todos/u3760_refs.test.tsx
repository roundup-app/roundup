import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { padOf } from "../pads/padsFixture";
import { padHandlers } from "../testing/stores";
import { USER } from "../testing/nodes";
import { mountTodos, todo, todoCallsTo } from "./testHarness";

afterEach(cleanup);

const panel = () => screen.getByRole("complementary", { name: "Drawer" });

const link = (name: string, heading = "") => `roundup://pad/${encodeURIComponent(name)}?project=k${heading === "" ? "" : `#${encodeURIComponent(heading)}`}`;

const open = async (refs: string[], missing: string[] = [], blockers: number[] = []) => {
  const m = await mountTodos([todo(1, { refs, blockers }), ...blockers.map((id) => todo(id))]);
  m.store.missing = new Set(missing);
  Object.assign(m.app.handlers, padHandlers({ pads: [padOf("notes", USER, "# Top\n\n## Plan\n\nstep one\n\n## 日本語\n\nlater\n")], history: [] }, () => {}));
  { const focusedRow = await screen.findByRole("button", { name: /^Idle #1 / }); focusedRow.focus(); fireEvent.keyDown(focusedRow, { key: "Enter", code: "Enter" }); }

  await within(panel()).findByRole("region", { name: /^Pads · / });

  return m;
};

it("u3760_a_ref_row_opens_its_pad_at_the_section", async () => {
  const scrolled: string[] = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) { scrolled.push(this.textContent ?? ""); });
  const whole = link("notes");
  const section = link("notes", "日本語");
  const m = await open([whole, section]);
  const rows = within(panel()).getAllByRole("link");
  // The Pad's name, and the heading beside it for a section link, in the order added.
  expect(rows.map((row) => row.textContent)).toEqual(["notes", "notes · 日本語"]);
  fireEvent.click(rows[1]!);
  await waitFor(() => expect(todoCallsTo(m.app, "todo.refs")).not.toHaveLength(0));
  await waitFor(() => expect(m.app.calls.filter((call) => call.method === "pad.read").map((call) => call.params)).toEqual([{ name: "notes" }]));
  await waitFor(() => expect(scrolled).toEqual(["日本語"]));
});

it("u3760_a_missing_ref_is_not_activatable", async () => {
  const gone = link("gone", "Old plan");
  const m = await open([link("notes"), gone], [gone]);
  const rows = [...panel().querySelectorAll<HTMLElement>(".todo-ref")];
  expect(rows).toHaveLength(2);
  const missing = rows[1]!;
  expect(within(missing).queryByRole("link")).toBeNull();
  expect(missing.textContent).toContain("gone");
  expect(missing.textContent).toContain("Old plan");
  expect(missing.textContent).toContain("Missing");
  fireEvent.click(missing.querySelector(".todo-ref-text")!);
  expect(m.app.calls.filter((call) => call.method === "pad.read")).toEqual([]);
});

it("u3760_remove_calls_once_and_events_update_the_list", async () => {
  const first = link("notes");
  const m = await open([first]);
  fireEvent.click(within(panel()).getByRole("button", { name: "Unlink notes" }));
  await waitFor(() => expect(todoCallsTo(m.app, "todo.removeRef")).toHaveLength(1));
  expect(todoCallsTo(m.app, "todo.removeRef")[0]!.params).toEqual({ id: 1, url: first });
  // The Daemon's event, not the click, takes the row away; a Todo with none shows no section.
  m.app.emit({ actor: USER, name: "todo.refRemoved", data: { id: 1 } });
  await waitFor(() => expect(within(panel()).queryByRole("region", { name: /^Pads · / })).toBeNull());
  // An Agent's add shows without reopening.
  const added = link("notes", "Plan");
  m.store.todos = m.store.todos.map((item) => ({ ...item, refs: [added] }));
  m.app.emit({ actor: { kind: "agent", id: "a", parent: null }, name: "todo.refAdded", data: { id: 1 } });
  await within(panel()).findByRole("region", { name: "Pads · 1" });
  expect(within(panel()).getAllByRole("link").map((row) => row.textContent)).toEqual(["notes · Plan"]);
});

it("u3760_removing_the_last_link_moves_focus_to_the_next_control", async () => {
  const m = await open([link("notes")], [], [2]);
  const button = within(panel()).getByRole("button", { name: "Unlink notes" });
  button.focus();
  m.store.todos = m.store.todos.map((item) => ({ ...item, refs: [] }));
  fireEvent.click(button);
  await waitFor(() => expect(todoCallsTo(m.app, "todo.removeRef")).toHaveLength(1));
  await waitFor(() => expect(within(panel()).queryByRole("region", { name: /^Pads · / })).toBeNull());
  await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  expect(panel().contains(document.activeElement)).toBe(true);
});
