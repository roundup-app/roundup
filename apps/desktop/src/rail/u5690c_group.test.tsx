import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, rowOf, settled } from "./railFixture";

afterEach(cleanup);

it("u5690c_existing_clients_traverse_and_rename_a_group_without_launching", async () => {
  const group = { ...workstream("group"), kind: "group" as const, status: null, work: null };
  const { app, rail } = await mountRail([group, workstream("home", { parent: "group" }), agent("child", "done", "finished", { parent: "home", terminal_id: null })]);
  app.handlers["rail.rename"] = ({ name }) => ({ ...group, name });
  const row = rowOf("group");
  row.focus();
  fireEvent.keyDown(row, { key: "Enter" });
  await settled();
  expect(rail.selected()).toBe("group");
  expect(rowOf("child").getAttribute("role")).toBe("treeitem");
  fireEvent.dblClick(screen.getByText("group"));
  const input = screen.getByLabelText("Name");
  fireEvent.input(input, { target: { value: "Chosen work" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await settled();
  expect(app.calls.filter(call => call.method === "rail.rename").map(call => call.params)).toEqual([{ id: "group", name: "Chosen work" }]);
  expect(app.calls.filter(call => /^(agent\.(spawn|resume|stop)|rail\.startDoor|terminal\.spawn)$/.test(call.method))).toEqual([]);
});
