import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { seedApp } from "../testing/seeds";
import { projectMenu } from "../testing/menuProbe";
import { railCallsTo } from "./railFixture";

afterEach(cleanup);

it.each([
  ["Workstream button", "rail.createWorkstream", false],
  ["Agent button", "agent.spawn", false],
  ["Workstream chord", "rail.createWorkstream", true],
  ["Agent chord", "agent.spawn", true],
] as const)("u4644_empty_rail_has_no_sections_and_runs_both_starts_%s", async (_, method, keyboard) => {
  const { app } = seedApp("empty-project", 0);
  render(() => <App app={app} clock={() => 0} reducedMotion={() => true} />);
  const empty = await screen.findByRole("group", { name: "No Agents yet" });
  expect(document.querySelectorAll(".rail-tree .section-head")).toHaveLength(0);
  expect(railCallsTo(app, "rail.createWorkstream")).toEqual([]);
  expect(railCallsTo(app, "agent.spawn")).toEqual([]);

  await waitFor(() => expect(projectMenu.items.find(item => item.id === "action:chord:⇧⌘N")?.label).toBe("New Workstream"));

  if (keyboard) fireEvent.keyDown(document, { key: "n", code: "KeyN", metaKey: true, shiftKey: method === "rail.createWorkstream" });
  else fireEvent.click(within(empty).getByRole("button", { name: method === "rail.createWorkstream" ? "New Workstream" : "New Agent" }));

  await waitFor(() => expect(railCallsTo(app, method)).toEqual(method === "rail.createWorkstream" ? [{ name: "workstream", parent: null }] : [{ cwd: "/Users/you/harness", prompt: null, parent: null, model: null, effort: null }]));
  if (method === "rail.createWorkstream") await waitFor(() => expect(railCallsTo(app, "rail.startDoor")).toHaveLength(1));
  expect(railCallsTo(app, method === "rail.createWorkstream" ? "agent.spawn" : "rail.createWorkstream")).toEqual([]);
});
