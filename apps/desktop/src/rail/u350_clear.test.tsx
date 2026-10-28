import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, door, workstream } from "../testing/nodes";
import { exitedTerminal, mountRail, railCallsTo, rowOf, settled } from "./railFixture";

afterEach(cleanup);

it("u350_workstream_actions_have_no_clear", async () => {
  const nodes = [door("running", "idle", "ready"), door("stopped", "done", "stopped"),
    door("resumable", "done", "stopped", { can_resume: true }), workstream("queued"), workstream("todo-blocked"),
    door("blocked", "blocked", "waiting for Todo"), agent("child", "idle", "ready", { parent: "running" })];
  const { app, rail, connected } = await mountRail(nodes, [exitedTerminal("stopped", 0), exitedTerminal("resumable", 0)]);
  app.handlers["workstream.queue"] = () => ({ running: 1, cap: null, entries: [{ workstream: "queued", start: { kind: "queued" } }, { workstream: "todo-blocked", start: { kind: "afterTodo", todo: 7 } }] });
  await connected.queue.refresh();
  for (const node of nodes) {
    const row = rowOf(node.name);
    fireEvent.click(row);
    await settled();
    fireEvent.mouseOver(row);
    row.focus();
    expect(within(row).queryByRole("button", { name: /clear/i })).toBeNull();
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    expect(app.menuLabels().some(label => /clear/i.test(label))).toBe(false);
    await app.closeMenu();
  }
  fireEvent.contextMenu(rowOf("running"));
  await app.pickMenu("Stop");
  expect(railCallsTo(app, "agent.stop")).toEqual([{ id: "running" }]);
  expect(railCallsTo(app, "workstream.clear")).toEqual([]);
  expect(screen.queryByRole("textbox", { name: /Why clear/i })).toBeNull();
  expect(rail.nodes.map(node => node.id)).toEqual(nodes.map(node => node.id));
});
