import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent } from "../testing/nodes";
import { menuProbe, questionProbe } from "../testing/menuProbe";
import { mountRail, rowOf, railCallsTo } from "./railFixture";

afterEach(cleanup);

const nodes = () => ["a", "b", "c", "d", "e"].map((id, order) => agent(id, "done", "", { terminal_id: null, order }));

const selected = () => [...document.querySelectorAll<HTMLElement>('.rail-row[data-selected=true]')].map(row => row.dataset.id);

const select = (...ids: string[]) => { for (const id of ids) fireEvent.click(rowOf(id), { metaKey: true }); };

it("u5690a_context_click_uses_the_selected_set_or_replaces_it", async () => {
  const { app, rail } = await mountRail(nodes());
  select("a", "c");
  fireEvent.contextMenu(rowOf("a"));
  expect(selected()).toEqual(["a", "c"]);
  await app.pickMenu(null);
  fireEvent.contextMenu(rowOf("d"));
  expect(selected()).toEqual(["d"]);
  expect(rail.selected()).toBeNull();
  await app.pickMenu(null);
  expect(app.calls.filter(call => /spawn|resume|stop|remove|group/.test(call.method))).toEqual([]);
});

it("u5690b_selection_menu_has_group_then_remove_all", async () => {
  const { app } = await mountRail(nodes());
  select("e", "a", "c");
  fireEvent.contextMenu(rowOf("c"));
  expect(menuProbe.shown?.map(item => item.id)).toEqual(["group", "remove-selection"]);
  expect(menuProbe.shown?.[1]?.shortcut).toBe("⌘⌫");
  await app.pickMenu(null);
});

it.each(["menu", "key"])("u5690d_remove_menu_and_chord_share_one_selection_question_%s", async entry => {
  const { app, rail } = await mountRail(nodes());
  select("e", "c", "a");
  expect(rail.selected()).toBeNull();

  if (entry === "menu") { fireEvent.contextMenu(rowOf("c")); await app.pickMenu("Remove all"); }
  else fireEvent.keyDown(rowOf("a"), { key: "Backspace", code: "Backspace", metaKey: true });
  await waitFor(() => expect(questionProbe.shown).not.toBeNull());
  expect(questionProbe.shown?.message).toContain("a\nc\ne");
  expect(railCallsTo(app, "rail.removeSelection")).toEqual([]);
  questionProbe.answer?.(false);
  await waitFor(() => expect(questionProbe.shown).toBeNull());
  expect(selected()).toEqual(["a", "c", "e"]);
});
