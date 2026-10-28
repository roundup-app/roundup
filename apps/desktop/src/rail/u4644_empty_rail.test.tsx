import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, railCallsTo } from "./railFixture";

afterEach(cleanup);

it.each([
  ["Workstream button", "rail.createWorkstream", false],
  ["Agent button", "agent.spawn", false],
  ["Workstream chord", "rail.createWorkstream", true],
  ["Agent chord", "agent.spawn", true],
] as const)("u4644_empty_rail_has_no_sections_and_runs_both_starts_%s", async (_, method, keyboard) => {
  const { app } = await mountRail([]);
  app.handlers["rail.createWorkstream"] = () => workstream("fresh");
  app.handlers["agent.spawn"] = () => agent("fresh", "idle", "starting");
  const empty = screen.getByRole("group", { name: "No Agents yet" });
  expect(document.querySelectorAll(".rail-tree .section-head")).toHaveLength(0);
  expect(railCallsTo(app, "rail.createWorkstream")).toEqual([]);
  expect(railCallsTo(app, "agent.spawn")).toEqual([]);

  if (keyboard) fireEvent.keyDown(document, { key: "n", code: "KeyN", metaKey: true, shiftKey: method === "rail.createWorkstream" });
  else fireEvent.click(within(empty).getByRole("button", { name: method === "rail.createWorkstream" ? "New Workstream" : "New Agent" }));

  await waitFor(() => expect(railCallsTo(app, method)).toEqual(method === "rail.createWorkstream" ? [{ name: "workstream", parent: null }] : [{ cwd: "/p", prompt: null, parent: null, model: null, effort: null }]));
  expect(railCallsTo(app, method === "rail.createWorkstream" ? "agent.spawn" : "rail.createWorkstream")).toEqual([]);
});
