import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, rowOf, settled } from "./railFixture";

afterEach(cleanup);

it("u5690c_existing_clients_traverse_and_rename_a_group_without_launching", async () => {
  const group = { ...workstream("group"), kind: "group" as const, status: null, work: null };
  const { app, rail } = await mountRail([group, workstream("home", { parent: "group" }), agent("child", "working", "Working", { parent: "home", terminal_id: null })]);
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
  fireEvent.contextMenu(rowOf("group"), { clientX: 120, clientY: 80 });
  expect(app.shownMenus.at(-1)?.items.filter(item => ["start", "stop", "resume", "restart", "yolo", "add"].includes(item.id))).toEqual([]);
  await app.closeMenu();
  expect(app.calls.filter(call => /^(agent\.(spawn|resume|stop)|rail\.startDoor|terminal\.spawn)$/.test(call.method))).toEqual([]);
});


it.each(["error", "needs-you"] as const)("u5690c_group_disclosure_preserves_keyboard_expansion_and_announces_hidden_%s", async kind => {
  const group = { ...workstream("group"), kind: "group" as const, status: null, work: null };

  const { rail, app } = await mountRail([group,
    workstream("home", { parent: "group" }),
    agent("failed", kind, "Repair required", { parent: "home" }),
    agent("waiting", "needs-you", "Answer required", { parent: "group", order: 1 }),
  ]);

  const before = rail.selected();
  fireEvent.click(within(rowOf("group")).getByRole("button", { name: "Collapse" }));
  await settled();
  expect(document.querySelector('[data-id="waiting"]')).toBeNull();
  expect(rail.selected()).toBe(before);
  expect(within(rowOf("group")).getByRole("img", { name: kind === "error" ? "Error" : "Needs-you" })).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Expand" }));
  await settled();
  expect(rowOf("waiting")).toBeDefined();
  rowOf("group").focus();
  fireEvent.keyDown(rowOf("group"), { key: "ArrowLeft" });
  await settled();
  expect(document.querySelector('[data-id="waiting"]')).toBeNull();
  fireEvent.keyDown(rowOf("group"), { key: "ArrowRight" });
  await settled();
  expect(rowOf("waiting")).toBeDefined();
  expect(app.calls.filter(call => /^(agent\.(spawn|resume|stop)|rail\.startDoor|terminal\.spawn)$/.test(call.method))).toEqual([]);
});

it("u5690c_group_centre_opens_a_child_without_starting_a_program", async () => {
  const group = { ...workstream("group"), kind: "group" as const, status: null, work: null };
  const { rail, app } = await mountRail([group, agent("child", "idle", "Ready", { parent: "group", terminal_id: null })], [], undefined, undefined, { pane: true });
  rail.select("group");
  await settled();
  fireEvent.click(screen.getByRole("button", { name: "child" }));
  await settled();
  expect(rail.selected()).toBe("child");
  expect(app.calls.filter(call => /^(agent\.(spawn|resume|stop)|rail\.startDoor|terminal\.spawn)$/.test(call.method))).toEqual([]);
});
