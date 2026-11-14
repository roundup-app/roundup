import { expect, it } from "vitest";
import { connectEvents } from "../app/events";
import { createFakeApp } from "../testing/fakeApp";
import { agent, node, workstream } from "../testing/nodes";
import { createRailState } from "../state/rail";
import { linkEntries } from "../ui/contextMenu";
import { alertLevel } from "./alertLevel";
import { judgeRemoval } from "./menu/removal";

const group = node("g", { kind: "group" });

it("ro5_a_group_in_the_tree_is_no_attempt_or_agent", async () => {
  // A Group carries no attempt, status or worktree: absent, not null.
  expect("attempt" in group).toBe(false);

  const parent = workstream("w", { alert_level: "silent" });
  const nodes = [parent, node("g", { kind: "group", parent: "w" }), agent("a", "idle", "ready", { parent: "w", alert_level: "silent" })];
  expect(alertLevel(nodes, parent)).toBe("silent");

  const app = createFakeApp();
  app.handlers["todo.list"] = () => [];
  app.handlers["pad.list"] = () => [];
  const removal = await judgeRemoval(app, [...nodes, node("x", { kind: "group", parent: "g" })], "g");
  expect(removal.removedIds).toEqual([]);
  expect(app.calls.filter(call => call.method === "agent.worktreeState")).toEqual([]);

  const sends = linkEntries(app, { kind: "agent", id: "a" }, nodes, () => true, () => {}).filter(entry => entry.id.startsWith("send:"));
  expect(sends.map(entry => entry.id)).toEqual([]);

  app.handlers["rail.tree"] = () => nodes;
  app.handlers["terminal.list"] = () => [];
  const rail = createRailState(app, await connectEvents(app));
  await rail.settled();
  expect(rail.dismissed(group)).toBe(false);
});
