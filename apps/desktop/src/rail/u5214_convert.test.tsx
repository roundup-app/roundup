import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf, exitedTerminal } from "./railFixture";
import { copy } from "./copy";

afterEach(() => { cleanup(); localStorage.clear(); });

const labelsOf = async (m: Awaited<ReturnType<typeof mountRail>>, id: string) => {
  fireEvent.contextMenu(rowOf(id), { clientX: 1, clientY: 1 });
  await waitFor(() => expect(m.app.shownMenus.length).toBeGreaterThan(0));
  const labels = m.app.menuLabels();
  await m.app.closeMenu();
  m.app.shownMenus.length = 0;

  return labels;
};

it("u5324_entries_follow_the_node_flags", async () => {
  const flags = (id: string, can_make_workstream: boolean, can_save_as_mode: boolean) =>
    agent(id, "working", "", { can_make_workstream, can_save_as_mode });

  const m = await mountRail([flags("both", true, true), flags("none", false, false), flags("mode", false, true), flags("ws", true, false)]);

  const offered = async (id: string) => {
    const labels = await labelsOf(m, id);

    return [labels.includes(copy.makeWorkstream), labels.includes(copy.saveAsMode)];
  };

  expect(await offered("both")).toEqual([true, true]);
  expect(await offered("none")).toEqual([false, false]);
  expect(await offered("mode")).toEqual([false, true]);
  expect(await offered("ws")).toEqual([true, false]);
});

it("u5324_unsaved_and_foreign_agents_get_no_entry", async () => {
  const m = await mountRail([agent("fresh", "working", "", { can_save_as_mode: true }), agent("foreign", "done", "", { can_make_workstream: true })], [exitedTerminal("foreign", 0)]);

  expect(await labelsOf(m, "fresh")).not.toContain(copy.makeWorkstream);
  expect(await labelsOf(m, "foreign")).not.toContain(copy.saveAsMode);
});

it("u5214_make_a_workstream_calls_the_method", async () => {
  const tree = [agent("a", "done", "", { can_resume: true, can_make_workstream: true })];
  const m = await mountRail(tree, [exitedTerminal("a", 0)]);
  m.app.handlers["agent.makeWorkstream"] = () => {
    tree[0] = workstream("a", { name: "a", attempt: "1", can_resume: true });

    return tree[0]!;
  };

  fireEvent.contextMenu(rowOf("a"), { clientX: 1, clientY: 1 });
  await m.app.pickMenu(copy.makeWorkstream);
  await waitFor(() => expect(m.rail.nodes[0]?.kind).toBe("workstream"));
  expect(railCallsTo(m.app, "agent.makeWorkstream")).toEqual([{ id: "a" }]);
  expect(m.rail.nodes[0]?.name).toBe("a");
});

it("u5214_save_as_mode_asks_for_a_name", async () => {
  const tree = [agent("a", "working", "", { can_save_as_mode: true })];
  const m = await mountRail(tree);
  m.app.handlers["agent.saveAsMode"] = () => workstream("mode", { opening_prompt: "p" });
  fireEvent.contextMenu(rowOf("a"), { clientX: 1, clientY: 1 });
  await m.app.pickMenu(copy.saveAsMode);
  const field = await screen.findByRole("textbox", { name: copy.name });
  fireEvent.keyDown(field, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("textbox", { name: copy.name })).toBeNull());
  expect(railCallsTo(m.app, "agent.saveAsMode")).toEqual([]);

  fireEvent.contextMenu(rowOf("a"), { clientX: 1, clientY: 1 });
  await m.app.pickMenu(copy.saveAsMode);
  fireEvent.input(await screen.findByRole("textbox", { name: copy.name }), { target: { value: "Reviewer" } });
  fireEvent.click(screen.getByRole("button", { name: copy.saveMode }));
  await waitFor(() => expect(railCallsTo(m.app, "agent.saveAsMode")).toEqual([{ id: "a", name: "Reviewer" }]));
});
