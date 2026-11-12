import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, rowOf } from "./railFixture";

afterEach(cleanup);

const strand = (id: string) => { fireEvent.click(rowOf(id)); rowOf(id).blur(); expect(document.activeElement).toBe(document.body); };

it("u6829b_rail_keys_work_when_a_click_leaves_focus_on_body (rename)", async () => {
  const { rail } = await mountRail([agent("a", "idle", "x"), agent("b", "idle", "x")]);
  strand("a");
  fireEvent.keyDown(document.body, { key: "F2", code: "F2", repeat: true });
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.keyDown(document.body, { key: "F2", code: "F2" });
  expect(screen.queryByRole("textbox")).not.toBeNull();
});

it("u6829b_rail_keys_work_when_a_click_leaves_focus_on_body (inert in a text field)", async () => {
  const { rail } = await mountRail([agent("a", "idle", "x")]);
  strand("a");
  expect(rail.selected()).toBe("a");
  const field = document.body.appendChild(document.createElement("input"));
  field.focus();
  fireEvent.keyDown(field, { key: "F2", code: "F2" });
  expect(document.querySelector(".rail input:not([type=hidden])")).toBeNull();
  field.remove();
});

it("u6829b_rail_keys_work_when_a_click_leaves_focus_on_body (row arrows)", async () => {
  const { rail } = await mountRail([agent("a", "idle", "x"), agent("b", "idle", "x")]);
  strand("a");
  fireEvent.keyDown(document.body, { key: "ArrowDown", code: "ArrowDown" });
  expect(rail.selected()).toBe("b");
});

it("u6829b_rail_keys_work_when_a_click_leaves_focus_on_body (collapse-expand)", async () => {
  const { rail } = await mountRail([workstream("g"), agent("a", "idle", "x", { parent: "g" })]);
  strand("g");
  fireEvent.keyDown(document.body, { key: "ArrowLeft", code: "ArrowLeft" });
  expect(rail.collapsed().has("g")).toBe(true);
});
