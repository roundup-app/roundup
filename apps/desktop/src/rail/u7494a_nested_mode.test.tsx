import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, mode, workstream } from "../testing/nodes";
import { copy } from "./copy";
import { captureActions } from "../keys/registry";
import { mountRail, railCallsTo, rowOf, rowNames, settled } from "./railFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

const tree = () => [
  workstream("Research", { order: 0 }),
  mode("Planner", "Plan", { order: 1 }),
  mode("Shape pad naming", "Shape the pad", { parent: "Planner", order: 0 }),
  mode("Shape mode subagents", "Shape the subagents", { parent: "Planner", order: 1 }),
  agent("Explore", "idle", "", { parent: "Shape mode subagents" }),
];

it("u7494a_a_nested_mode_shows_beneath_its_starter_with_restart", async () => {
  const nodes = tree();
  const m = await mountRail(nodes);
  const modes = () => {
    const found = [...document.querySelectorAll<HTMLElement>(".rail-section")].find(section => section.querySelector('[data-id="Planner"]'));
    if (!found) throw new Error("Planner has no section");

    return found;
  };
  expect(within(modes()).getAllByRole("treeitem").filter(row => row.hasAttribute("data-id")).map(row => row.getAttribute("data-id")))
    .toEqual(["Planner", "Shape pad naming", "Shape mode subagents", "Explore"]);
  expect(rowNames()).toContain("Explore");
  const nested = nodes[2];

  if (!nested) throw new Error("tree has no nested Mode");

  m.app.handlers["agent.restartMode"] = () => nested;

  fireEvent.click(within(rowOf("Shape pad naming")).getByRole("button", { name: copy.restart }));
  await waitFor(() => expect(railCallsTo(m.app, "agent.restartMode")).toEqual([{ id: "Shape pad naming", request: expect.any(String) }]));
  await m.rail.settled();
  // Clearing its first prompt leaves it beneath Planner, in the same section.

  nodes[2] = mode("Shape pad naming", "", { parent: "Planner", order: 0, mode_prompt: null });
  await m.rail.refresh();
  expect(within(modes()).getAllByRole("treeitem").filter(row => row.hasAttribute("data-id")).map(row => row.getAttribute("data-id")))
    .toEqual(["Planner", "Shape pad naming", "Shape mode subagents", "Explore"]);
});

it("u7494a_a_nested_mode_cannot_be_moved", async () => {
  const m = await mountRail(tree());
  await settled();
  const row = rowOf("Shape pad naming");
  expect(row.getAttribute("aria-roledescription")).toBeNull();
  row.focus();
  fireEvent.keyDown(row, { key: "m", code: "KeyM" });
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(captureActions(row).some(action => action.keys === "M" && action.available())).toBe(false);
  expect(railCallsTo(m.app, "rail.move")).toEqual([]);
});
