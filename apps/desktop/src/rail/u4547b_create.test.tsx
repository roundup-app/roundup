import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { workstream, agent } from "../testing/nodes";
import { RpcError } from "../app/seam";
import { mountRail, railCallsTo, rowOf } from "./railFixture";

afterEach(() => { cleanup(); localStorage.clear(); });

it("u4547b_create_selects_one_mode_after_saving_its_prompt", async () => {
  const tree = [workstream("existing")];
  const m = await mountRail(tree);
  const order: string[] = [];
  m.app.handlers["rail.createWorkstream"] = () => { order.push("create"); const made = workstream("made"); tree.push(made);

 return made; };

  m.app.handlers["workstream.setOpeningPrompt"] = ({ prompt }) => { order.push("save"); tree[1]!.opening_prompt = prompt ?? "";

 return null; };

  let finishStart!: () => void;
  m.app.handlers["workstream.restart"] = async () => {
    order.push("restart");
    await new Promise<void>(resolve => { finishStart = resolve; });

    return tree[1]!;
  };

  fireEvent.click(screen.getByRole("button", { name: "New Mode" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "  Review  " } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: "  Review e\u0301 🧭\n " } });
  fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(rowOf("made")));
  expect(order).toEqual(["create", "save", "restart"]);
  finishStart();
  expect(railCallsTo(m.app, "rail.createWorkstream")).toEqual([{ name: "Review", parent: null }]);
  expect(railCallsTo(m.app, "workstream.setOpeningPrompt")).toEqual([{ id: "made", prompt: "  Review e\u0301 🧭\n " }]);
  expect(m.rail.selected()).toBe("made");
  expect(railCallsTo(m.app, "rail.startDoor")).toEqual([]);
});

it.each(["create", "save"])("u4547b_failed_creation_keeps_input_and_retries_the_same_workstream_%s", async failure => {
  const tree = [workstream("existing")];
  const m = await mountRail(tree);
  m.app.handlers["rail.createWorkstream"] = () => {
    if (failure === "create") throw new RpcError(-32003, "Create refused");
    const made = workstream("made");
    tree.push(made);

    return made;
  };

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
  m.app.handlers["rail.createWorkstream"] = () => { const made = workstream("made"); tree.push(made);

 return made; };

  m.app.handlers["workstream.setOpeningPrompt"] = () => null;
  m.app.handlers["workstream.restart"] = () => tree[1]!;
  fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(railCallsTo(m.app, "rail.createWorkstream")).toHaveLength(failure === "create" ? 2 : 1);
  expect(railCallsTo(m.app, "workstream.restart")).toHaveLength(1);
});

it.each(["", " \n "])("u4547b_blank_values_cannot_create_%j", async blank => {
  const m = await mountRail([workstream("w")]);
  fireEvent.click(screen.getByRole("button", { name: "New Mode" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: blank } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: "prompt" } });
  expect(screen.getByRole("button", { name: "Create Mode" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
  expect(railCallsTo(m.app, "rail.createWorkstream")).toEqual([]);
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "name" } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: blank } });
  expect(screen.getByRole("button", { name: "Create Mode" }).getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
  expect(railCallsTo(m.app, "rail.createWorkstream")).toEqual([]);
  (await screen.findByRole<HTMLElement>("textbox", { name: "First prompt" })).focus();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "First prompt" }), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(railCallsTo(m.app, "rail.createWorkstream")).toEqual([]);
});

it("u4547b_creation_drafts_keep_their_project_and_exact_text", async () => {
  await mountRail([workstream("w")]);
  fireEvent.click(screen.getByRole("button", { name: "New Mode" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: " exact name " } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: " e\u0301 🧭\n " } });
  cleanup();
  const other = await mountRail([workstream("other")], [], undefined, undefined, {}, [], { name: "other", path: "/other" });
  fireEvent.click(screen.getByRole("button", { name: "New Mode" }));
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Name" }).value).toBe("");
  expect(railCallsTo(other.app, "rail.createWorkstream")).toEqual([]);
  cleanup();
  const original = await mountRail([workstream("w")]);
  fireEvent.click(screen.getByRole("button", { name: "New Mode" }));
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Name" }).value).toBe(" exact name ");
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "First prompt" }).value).toBe(" e\u0301 🧭\n ");
  expect(railCallsTo(original.app, "rail.createWorkstream")).toEqual([]);
});


it("u4547b_other_footer_actions_keep_their_kind", async () => {
  const m = await mountRail([workstream("w")]);
  m.app.handlers["agent.spawn"] = () => agent("new", "idle", "");
  fireEvent.click(screen.getByRole("button", { name: "New Agent" }));
  await waitFor(() => expect(railCallsTo(m.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: null, model: null, effort: null }]));
  expect(railCallsTo(m.app, "rail.createWorkstream")).toEqual([]);
  expect(railCallsTo(m.app, "workstream.setOpeningPrompt")).toEqual([]);
});

it("u4547b_late_creation_failure_preserves_the_newer_draft", async () => {
  const m = await mountRail([workstream("w")]);
  let refuse!: (error: Error) => void;
  m.app.handlers["rail.createWorkstream"] = () => new Promise((_, reject) => { refuse = reject; });
  fireEvent.click(screen.getByRole("button", { name: "New Mode" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "First" } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: " first\n " } });
  fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
  await waitFor(() => expect(railCallsTo(m.app, "rail.createWorkstream")).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "New Mode" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Second" } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: " second\n " } });
  refuse(new RpcError(-32003, "Create refused"));
  await waitFor(() => expect(m.connected.drafts.list().some(draft => draft.status === "failed")).toBe(true));
  expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "First prompt" }).value).toBe(" second\n ");
  expect(m.connected.drafts.list().map(draft => draft.value.text)).toEqual([" first\n ", " second\n "]);
  expect(railCallsTo(m.app, "workstream.restart")).toEqual([]);
});

it("u4547b_start_failure_is_retried_on_the_created_row", async () => {
  const tree = [workstream("existing")];
  const m = await mountRail(tree, [], undefined, () => true);
  m.app.handlers["rail.createWorkstream"] = () => {
    const made = workstream("made");
    tree.push(made);

    return made;
  };

  m.app.handlers["workstream.setOpeningPrompt"] = ({ prompt }) => {
    tree[1]!.opening_prompt = prompt ?? "";

    return null;
  };

  m.app.handlers["workstream.restart"] = () => { throw new RpcError(-32003, "Door could not start; retry"); };

  fireEvent.click(screen.getByRole("button", { name: "New Mode" }));
  fireEvent.input(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Review" } });
  fireEvent.input(screen.getByRole("textbox", { name: "First prompt" }), { target: { value: "Review changes" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Mode" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await screen.findByRole("alert");
  expect(document.activeElement).toBe(rowOf("made"));
  const first = railCallsTo(m.app, "workstream.restart")[0];
  m.app.handlers["workstream.restart"] = () => tree[1]!;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(railCallsTo(m.app, "workstream.restart")).toEqual([first, first]));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(railCallsTo(m.app, "rail.createWorkstream")).toHaveLength(1);
});
