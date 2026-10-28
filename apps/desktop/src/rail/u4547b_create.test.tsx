import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { RpcError } from "../app/seam";
import { mountRail, railCallsTo } from "./railFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u4547b_create_selects_one_mode_after_saving_its_prompt", async () => {
  const tree = [workstream("existing")];
  const m = await mountRail(tree);
  const order: string[] = [];
  m.app.handlers["rail.createWorkstream"] = () => { order.push("create"); const made = workstream("made"); tree.push(made); return made; };
  m.app.handlers["workstream.setOpeningPrompt"] = ({ prompt }) => { order.push("save"); tree[1]!.opening_prompt = prompt ?? null; return null; };
  m.app.handlers["workstream.restart"] = () => { order.push("restart"); return tree[1]!; };
  fireEvent.click(screen.getByRole("button", { name: "New Mode" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "  Review  " } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: "  Review e\u0301 🧭\n " } });
  fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(order).toEqual(["create", "save", "restart"]);
  expect(railCallsTo(m.app, "rail.createWorkstream")).toEqual([{ name: "Review", parent: null }]);
  expect(railCallsTo(m.app, "workstream.setOpeningPrompt")).toEqual([{ id: "made", prompt: "  Review e\u0301 🧭\n " }]);
  expect(m.rail.selected()).toBe("made");
  expect(railCallsTo(m.app, "rail.startDoor")).toEqual([]);
});

it("u4547b_failed_creation_keeps_input_and_retries_the_same_workstream", async () => {
  const tree = [workstream("existing")];
  const m = await mountRail(tree);
  m.app.handlers["rail.createWorkstream"] = () => { const made = workstream("made"); tree.push(made); return made; };
  m.app.handlers["workstream.setOpeningPrompt"] = () => { throw new RpcError(-32003, "Save refused"); };
  fireEvent.click(screen.getByRole("button", { name: "New Mode" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: " Review " } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: " exact\n " } });
  fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
  await screen.findByRole("alert");
  expect(railCallsTo(m.app, "workstream.restart")).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "New Mode" }));
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "First prompt" }).value).toBe(" exact\n ");
  m.app.handlers["workstream.setOpeningPrompt"] = () => null;
  m.app.handlers["workstream.restart"] = () => tree[1]!;
  fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(railCallsTo(m.app, "rail.createWorkstream")).toHaveLength(1);
  expect(railCallsTo(m.app, "workstream.restart")).toHaveLength(1);
});
