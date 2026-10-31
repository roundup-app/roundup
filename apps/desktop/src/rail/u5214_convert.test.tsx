import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, door, workstream } from "../testing/nodes";
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

it("u5214_offered_entries_match_the_daemon_guard", async () => {
  const tree = [
    agent("running", "working", "", { can_make_workstream: true, can_save_as_mode: true }),
    agent("exited", "done", "", { can_resume: true, can_make_workstream: true, can_save_as_mode: true }),
    agent("nothing", "done", "", { can_save_as_mode: true }),
    workstream("ws"),
    agent("child", "working", "", { parent: "ws", can_save_as_mode: true }),
    door("lead", "working", ""),
  ];

  const m = await mountRail(tree, [exitedTerminal("exited", 0), exitedTerminal("nothing", 0)]);

  const offered = async (id: string) => {
    const labels = await labelsOf(m, id);

    return [labels.includes(copy.makeWorkstream), labels.includes(copy.saveAsMode)];
  };

  expect(await offered("running")).toEqual([true, true]);
  expect(await offered("exited")).toEqual([true, true]);
  expect(await offered("nothing")).toEqual([false, true]);
  expect(await offered("child")).toEqual([false, true]);
  expect(await offered("ws")).toEqual([false, false]);
  expect(await offered("lead")).toEqual([false, false]);
});

it("u5287_the_entries_follow_the_row_flags", async () => {
  const tree = [
    agent("by-hand", "working", "", { can_make_workstream: true }),
    agent("just-launched", "working", "", { can_save_as_mode: true }),
    agent("neither", "working", ""),
  ];

  const m = await mountRail(tree);

  const offered = async (id: string) => {
    const labels = await labelsOf(m, id);

    return [labels.includes(copy.makeWorkstream), labels.includes(copy.saveAsMode)];
  };

  expect(await offered("by-hand")).toEqual([true, false]);
  expect(await offered("just-launched")).toEqual([false, true]);
  expect(await offered("neither")).toEqual([false, false]);
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
