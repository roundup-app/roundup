import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mode, agent } from "../testing/nodes";
import { mountRail, railCallsTo, rowOf } from "./railFixture";
import { copy } from "./copy";

afterEach(() => { cleanup(); localStorage.clear(); });

it.each([" exact e\u0301\n ", ""])("u4547c_saving_reclassifies_the_same_agent_without_launching_%j", async prompt => {
  const tree = [mode("w", "previous"), agent("child", "idle", "", { parent: "w" })];
  const m = await mountRail(tree);
  m.rail.select("w");
  m.app.handlers["agent.setModePrompt"] = ({ prompt }) => { tree[0] = { ...tree[0]!, mode_prompt: prompt ?? "" };

 return null; };

  fireEvent.contextMenu(rowOf("w"));
  await m.app.pickMenu(copy.modePromptMenu);
  const field = await screen.findByRole("textbox", { name: copy.modePrompt });
  {
    fireEvent.input(field, { target: { value: prompt } });
    fireEvent.blur(field);
    await waitFor(() => expect(m.connected.drafts.list()).toEqual([]));
    expect(tree[0]!.mode_prompt).toBe(prompt);
    fireEvent.click(screen.getByRole("button", { name: copy.close }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("treeitem", { name: prompt ? copy.modesHead : copy.agentsHead })).toBeTruthy();
    expect(m.rail.selected()).toBe("w");
    expect(m.rail.nodes.find(node => node.id === "w")).toMatchObject({ attempt: "1", terminal_id: "t-w" });
    expect(m.rail.nodes.find(node => node.id === "child")?.parent).toBe("w");
  }

  expect(railCallsTo(m.app, "agent.restartMode")).toEqual([]);
  expect(railCallsTo(m.app, "rail.startDoor")).toEqual([]);
  expect(railCallsTo(m.app, "agent.steer")).toEqual([]);
});

it("u4547c_prompt_draft_preserves_identity_and_conflicts", async () => {
  const tree = [mode("w", "original")];
  const m = await mountRail(tree);
  fireEvent.contextMenu(rowOf("w"));
  await m.app.pickMenu(copy.modePromptMenu);
  fireEvent.input(await screen.findByRole("textbox", { name: copy.modePrompt }), { target: { value: " exact draft\n " } });
  tree[0] = { ...tree[0]!, mode_prompt: "external edit" };
  await m.rail.refresh();
  expect(within(screen.getByRole("dialog")).getByRole("status")).toBeTruthy();
  cleanup();
  const other = await mountRail([mode("w", "other")], [], undefined, undefined, {}, [], { name: "other", path: "/other" });
  fireEvent.contextMenu(rowOf("w"));
  await other.app.pickMenu(copy.modePromptMenu);
  expect((await screen.findByRole<HTMLTextAreaElement>("textbox", { name: copy.modePrompt })).value).toBe("other");
  cleanup();
  const reopened = await mountRail(tree);
  fireEvent.contextMenu(rowOf("w"));
  await reopened.app.pickMenu(copy.modePromptMenu);
  expect((await screen.findByRole<HTMLTextAreaElement>("textbox", { name: copy.modePrompt })).value).toBe(" exact draft\n ");
  expect(within(screen.getByRole("dialog")).getByRole("status")).toBeTruthy();
  expect(railCallsTo(reopened.app, "agent.setModePrompt")).toEqual([]);
});
