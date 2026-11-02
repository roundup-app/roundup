import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, door, workstream } from "../testing/nodes";
import { mountRail, rowOf } from "./railFixture";
import { RpcError } from "../app/seam";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u5501_menus_change_only_the_clicked_scope", async () => {
  const tree = [agent("a", "idle", "ready"), agent("b", "working", "busy")];
  const { app, rail } = await mountRail(tree);
  rail.select("a");
  app.handlers["rail.setAlertLevel"] = ({ id, level }) => { app.handlers["rail.tree"] = () => tree.map(node => node.id === id ? { ...node, alert_level: level } : { ...node });

 return null; };

  fireEvent.contextMenu(rowOf("b"));
  expect(rail.selected()).toBe("a");
  expect(app.shownMenus.at(-1)?.items.find(item => item.id === "alerts")?.children?.filter(item => item.checked).map(item => item.id)).toEqual(["alerts:default"]);
  await app.pickMenu("Quiet");
  await waitFor(() => expect(rail.nodes.find(node => node.id === "b")?.alert_level).toBe("quiet"));
  expect(app.calls.filter(call => call.method === "rail.setAlertLevel").map(call => call.params)).toEqual([{ project: "/project", id: "b", level: "quiet" }]);
  rowOf("b").focus();
  fireEvent.keyDown(rowOf("b"), { key: "F10", shiftKey: true });
  await waitFor(() => expect(app.shownMenus).toHaveLength(2));
  expect(app.shownMenus.at(-1)?.items.find(item => item.id === "alerts")?.children?.filter(item => item.checked).map(item => item.id)).toEqual(["alerts:quiet"]);
  await app.closeMenu();
  expect(rail.selected()).toBe("a");
  expect(app.calls.filter(call => ["agent.spawn", "agent.resume", "message.send", "terminal.write"].includes(call.method))).toEqual([]);
});

it("u5501_mixed_and_empty_workstreams_have_no_checked_choice", async () => {
  const { app } = await mountRail([door("w", "idle", "ready", { alert_level: "quiet" }), agent("a", "working", "busy", { parent: "w", alert_level: "all" }), workstream("empty")]);

  for (const id of ["w", "empty"]) {
    fireEvent.contextMenu(rowOf(id));
    expect(app.shownMenus.at(-1)?.items.find(item => item.id === "alerts")?.children?.filter(item => item.checked)).toEqual([]);
    await app.closeMenu();
  }
});

it("u5501_a_refused_choice_keeps_the_level_and_shows_its_cause", async () => {
  const { app, rail } = await mountRail([agent("a", "working", "busy", { alert_level: "all" })]);
  app.handlers["rail.setAlertLevel"] = () => { throw new RpcError(-32003, "Level could not be saved. Retry."); };

  fireEvent.contextMenu(rowOf("a"));
  await app.pickMenu("Quiet");
  expect(rail.nodes[0]?.alert_level).toBe("all");
  expect(rail.commandFailure.message()).toContain("Level could not be saved");
});
