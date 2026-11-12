import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mode, workstream, agent } from "../testing/nodes";
import { RpcError } from "../app/seam";
import { chooseFooter, mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u4547b_create_selects_one_mode_after_saving_its_prompt", async () => {
  const tree = [workstream("existing")];
  const m = await mountRail(tree);
  const order: string[] = [];
  m.app.handlers["agent.createMode"] = ({ prompt }) => { order.push("create"); const made = mode("made", prompt); tree.push(made);

 return made; };

  let finishStart!: () => void;
  m.app.handlers["agent.restartMode"] = async () => {
    order.push("restart");
    await new Promise<void>(resolve => { finishStart = resolve; });

    return tree[1]!;
  };

  await chooseFooter("Mode");
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "  Review  " } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: "  Review e\u0301 🧭\n " } });
  fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(rowOf("made")));
  expect(order).toEqual(["create", "restart"]);
  finishStart();
  expect(railCallsTo(m.app, "agent.createMode")).toEqual([{ name: "Review", prompt: "  Review e\u0301 🧭\n " }]);
  expect(railCallsTo(m.app, "agent.restartMode")).toEqual([{ id: "made", request: expect.any(String) }]);
  expect(m.rail.selected()).toBe("made");
  expect(railCallsTo(m.app, "rail.startDoor")).toEqual([]);
});

it("u4547b_failed_creation_keeps_input_and_retries_create", async () => {
  const tree = [workstream("existing")];
  const m = await mountRail(tree);
  let fail = true;
  m.app.handlers["agent.createMode"] = ({ prompt }) => {
    if (fail) throw new RpcError(-32003, "Create refused");
    const made = mode("made", prompt);
    tree.push(made);

    return made;
  };

  await chooseFooter("Mode");
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: " Review " } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: " exact\n " } });
  fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
  await screen.findByRole("alert");
  expect(railCallsTo(m.app, "agent.restartMode")).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await chooseFooter("Mode");
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "First prompt" }).value).toBe(" exact\n ");
  fail = false;
  m.app.handlers["agent.restartMode"] = () => tree[1]!;
  fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(railCallsTo(m.app, "agent.createMode")).toHaveLength(2);
  expect(railCallsTo(m.app, "agent.restartMode")).toHaveLength(1);
});

it.each(["", " \n "])("u4547b_blank_values_cannot_create_%j", async blank => {
  const m = await mountRail([workstream("w")]);
  await chooseFooter("Mode");
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: blank } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: "prompt" } });
  expect(screen.getByRole("button", { name: "Create Mode" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
  expect(railCallsTo(m.app, "agent.createMode")).toEqual([]);
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "name" } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: blank } });
  expect(screen.getByRole("button", { name: "Create Mode" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
  expect(railCallsTo(m.app, "agent.createMode")).toEqual([]);
  (await screen.findByRole<HTMLElement>("textbox", { name: "First prompt" })).focus();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "First prompt" }), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(railCallsTo(m.app, "rail.createWorkstream")).toEqual([]);
});

it("u4547b_creation_drafts_keep_their_project_and_exact_text", async () => {
  await mountRail([workstream("w")]);
  await chooseFooter("Mode");
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: " exact name " } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: " e\u0301 🧭\n " } });
  cleanup();
  const other = await mountRail([workstream("other")], [], undefined, undefined, {}, [], { name: "other", path: "/other" });
  await chooseFooter("Mode");
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Name" }).value).toBe("");
  expect(railCallsTo(other.app, "agent.createMode")).toEqual([]);
  cleanup();
  const original = await mountRail([workstream("w")]);
  await chooseFooter("Mode");
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Name" }).value).toBe(" exact name ");
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "First prompt" }).value).toBe(" e\u0301 🧭\n ");
  expect(railCallsTo(original.app, "agent.createMode")).toEqual([]);
});


it("u4547b_other_footer_actions_keep_their_kind", async () => {
  const m = await mountRail([workstream("w")]);
  m.app.handlers["agent.spawn"] = () => agent("new", "idle", "");
  await chooseFooter("Agent");
  await waitFor(() => expect(railCallsTo(m.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: null, model: null, effort: null }]));
  expect(railCallsTo(m.app, "rail.createWorkstream")).toEqual([]);
  expect(railCallsTo(m.app, "agent.createMode")).toEqual([]);
});

it("u4547b_late_creation_failure_preserves_the_newer_draft", async () => {
  const m = await mountRail([workstream("w")]);
  let refuse!: (error: Error) => void;
  m.app.handlers["agent.createMode"] = () => new Promise((_, reject) => { refuse = reject; });
  await chooseFooter("Mode");
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "First" } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: " first\n " } });
  fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
  await waitFor(() => expect(railCallsTo(m.app, "agent.createMode")).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await chooseFooter("Mode");
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Second" } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: " second\n " } });
  refuse(new RpcError(-32003, "Create refused"));
  await waitFor(() => expect(m.connected.drafts.list().some(draft => draft.status === "failed")).toBe(true));
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "First prompt" }).value).toBe(" second\n ");
  expect(m.connected.drafts.list().map(draft => draft.value.text)).toEqual([" first\n ", " second\n "]);
  expect(railCallsTo(m.app, "agent.restartMode")).toEqual([]);
});

it("u4547b_start_failure_is_retried_on_the_created_row", async () => {
  const tree = [workstream("existing")];
  const m = await mountRail(tree, [], undefined, () => true);
  m.app.handlers["agent.createMode"] = ({ prompt }) => {
    const made = mode("made", prompt);
    tree.push(made);

    return made;
  };

  m.app.handlers["agent.restartMode"] = () => { throw new RpcError(-32003, "Mode Agent could not start; retry"); };

  await chooseFooter("Mode");
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Review" } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: "Review changes" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await screen.findByRole("alert");
  expect(document.activeElement).toBe(rowOf("made"));
  const first = railCallsTo(m.app, "agent.restartMode")[0];
  m.app.handlers["agent.restartMode"] = () => tree[1]!;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(railCallsTo(m.app, "agent.restartMode")).toEqual([first, first]));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(railCallsTo(m.app, "agent.createMode")).toHaveLength(1);
});
