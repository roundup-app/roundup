import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { openProjectPage } from "../testing/menuProbe";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { Message } from "@contracts/message/Message";
import type { Reaction } from "@contracts/reaction/Reaction";
import { RpcError } from "../app/seam";
import { agent, door, workstream } from "../testing/nodes";
import { mountAskBar } from "../ask/askFixture";
import { copy } from "../copy";
import { openTabs, path, tab } from "../header/stripFixture";

afterEach(cleanup);

const saved = (patch: Partial<Reaction> = {}): Reaction => ({
  project: "p", id: "r1", name: "Ship it", actor: { kind: "user", id: "u", parent: null }, home: null, target: "a",
  instruction: "go", condition: { kind: "agents", ids: ["a"], any: false }, max_firings: 1, remaining: 1, rearm: false,
  expires_at: "2026-10-21T09:00:00Z", created_at: "2026-10-20T09:00:00Z", state: "active",
  observation: { health: "observing", health_code: "observing", cause_code: "unknown", gap_code: "unknown", recovery_code: "unknown", cursor: null, gap: null, recovery: null, evidence: null }, firings: [], ...patch,
});

const mount = async (list: () => Reaction[], homes: ReturnType<typeof workstream>[] = []) => {
  const mounted = await mountAskBar([], null, [...homes, agent("a", "idle", "ready")]);

  mounted.connected.hideView("made");
  mounted.app.handlers["reaction.list"] = list;
  mounted.app.handlers["reaction.get"] = ({ id }) => list().find(reaction => reaction.id === id)!;
  window.dispatchEvent(new Event("focus"));

  return mounted;
};

it("z3788c_only_the_current_reactions_owner_refreshes_on_focus", async () => {
  const first = await mount(() => [saved()]);
  await screen.findByRole("button", { name: /Ship it/ });
  first.unmount();
  const second = await mount(() => [saved({ name: "Current reaction" })]);
  await screen.findByRole("button", { name: /Current reaction/ });
  const oldCalls = first.app.calls.filter(call => call.method === "reaction.list").length;
  const currentCalls = second.app.calls.filter(call => call.method === "reaction.list").length;

  window.dispatchEvent(new Event("focus"));
  await waitFor(() => expect(second.app.calls.filter(call => call.method === "reaction.list")).toHaveLength(currentCalls + 1));
  expect(first.app.calls.filter(call => call.method === "reaction.list")).toHaveLength(oldCalls);
  second.unmount();
  window.dispatchEvent(new Event("focus"));
  expect(second.app.calls.filter(call => call.method === "reaction.list")).toHaveLength(currentCalls + 1);
});

it("nr9_create_inspect_stop_run_and_focus", async () => {
  let current = saved();
  const { app } = await mount(() => [current]);
  const row = await screen.findByRole("button", { name: /Ship it/ });

  row.focus();
  fireEvent.click(row);
  const detail = await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });

  expect(app.calls.map((call) => call.method)).not.toContain("reaction.run");
  app.handlers["reaction.stop"] = () => (current = saved({ state: "stopped" }));
  app.handlers["reaction.run"] = () => current;
  fireEvent.click(within(detail).getByRole("button", { name: copy.reactionRun }));
  await waitFor(() => expect(app.calls.filter((call) => call.method === "reaction.run")).toHaveLength(1));
  await waitFor(() => expect(within(detail).getByRole("button", { name: copy.reactionStop })).toHaveProperty("disabled", false));
  fireEvent.click(within(detail).getByRole("button", { name: copy.reactionStop }));
  await waitFor(() => expect(within(detail).getByRole("button", { name: copy.reactionRun })).toHaveProperty("disabled", true));
  fireEvent.click(within(detail).getByRole("button", { name: /^Close/ }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /Ship it/ })));
});

it("nr9_failed_creation_preserves_original_draft", async () => {
  const { app, connected } = await mount(() => []);
  await screen.findByText(copy.reactionsEmpty);

  const destination = { surface: "reactions", object: "create", recipient: null };

  const value = {
    operation: "op-1", name: "Mine", target: "a", instruction: "exact\n words ", kind: "pr-checks", ids: [], any: false,
    repository: "o/r", number: "7", atDate: "", atTime: "", atOffset: "Z", expDate: "2026-10-21", expTime: "09:00", expOffset: "Z",
    maxFirings: "1", rearm: false,
  };

  await connected.drafts.edit(destination, value, null, "ordinary").retained;
  app.handlers["reaction.preview"] = () => ({ at: "2026-10-21T09:00:00Z", utc: "2026-10-21T09:00:00Z", offset: "Z" });
  let refuse = true;

  app.handlers["reaction.create"] = () => {
    if (refuse) throw new RpcError(-32602, "no room");

    return saved();
  };

  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));

  const save = await screen.findByRole("button", { name: copy.reactionSave });

  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  fireEvent.click(save);
  await waitFor(() => expect(app.calls.some(call => call.method === "reaction.create")).toBe(true));
  await screen.findByText(copy.reactionNotCreated("no room"));
  expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", "exact\n words ");
  refuse = false;
  await waitFor(() => expect(screen.getByRole("button", { name: copy.reactionSave })).toHaveProperty("disabled", false));
  fireEvent.click(screen.getByRole("button", { name: copy.reactionSave }));
  await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });

  const sent = app.calls.filter((call) => call.method === "reaction.create").map((call) => call.params);

  expect(sent).toMatchObject([{ operation: "op-1", instruction: "exact\n words " }, { operation: "op-1", instruction: "exact\n words " }]);
  expect(connected.drafts.list().filter((draft) => draft.destination.surface === "reactions")).toEqual([]);
});

it("u3299a_named_targets_keep_identity", async () => {
  const { app, connected } = await mountAskBar([], null, [
    workstream("build", { name: "Build" }), workstream("check", { name: "Check" }),
    agent("a", "idle", "ready", { name: "Builder", parent: "build" }),
    agent("b", "idle", "ready", { name: "Builder", parent: "check" }),
  ]);

  app.handlers["reaction.list"] = () => [];
  app.handlers["reaction.preview"] = () => ({ at: "2026-10-21T09:00:00Z", utc: "2026-10-21T09:00:00Z", offset: "Z" });
  app.handlers["reaction.create"] = () => saved({ target: "b", condition: { kind: "agents", ids: ["a"], any: false } });
  await connected.drafts.edit({ surface: "reactions", object: "create", recipient: null }, {
    operation: "op-overlap", name: "Ship it", target: "", instruction: "go", kind: "agents", ids: [], any: false,
    repository: "", number: "", atDate: "", atTime: "", atOffset: "Z", expDate: "2026-10-21", expTime: "09:00", expOffset: "Z",
    maxFirings: "1", rearm: false,
  }, null, "ordinary").retained;
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  fireEvent.click(screen.getByRole("button", { name: /^Target Agent/ }));
  fireEvent.click(await screen.findByRole("option", { name: "Builder · Check" }));
  const preview = screen.getByRole("region", { name: copy.reactionPreview });

  await within(preview).findByText("Builder · Check");
  fireEvent.click(screen.getByRole("checkbox", { name: "Builder · Build" }));
  await within(preview).findByText(/All of Builder · Build finish/);
  const save = screen.getByRole("button", { name: copy.reactionSave });

  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  fireEvent.click(save);
  await waitFor(() => expect(app.calls.some(call => call.method === "reaction.create")).toBe(true));
  const detail = await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });

  expect(app.calls.find((call) => call.method === "reaction.create")?.params).toMatchObject({ target: "b", condition: { ids: ["a"] } });
  expect(within(detail).getByText(/All of Builder · Build finish/)).toBeTruthy();
});

it("nr9_firing_opens_only_its_recorded_message_and_returns_focus", async () => {
  const { app } = await mount(() => [saved({ firings: [{ id: "f1", ordinal: 1, message: 42, matched: true, evidence: "finished", definition: "{}", outcome: "pending" }] })]);
  app.handlers["message.get"] = () => ({ id: 42, from: { kind: "user", id: "u", parent: null }, to: "a", body: "exact accepted instruction", kind: "note", replyTo: null, status: "dropped", reason: "receiver gone", at: 0 });
  fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
  const link = await screen.findByRole("button", { name: /Firing 1/ });
  fireEvent.click(link);
  await screen.findByText("exact accepted instruction");
  expect(app.calls.filter(call => call.method === "message.get").map(call => call.params)).toEqual([{ id: 42 }]);
  expect(screen.getByText(/Not delivered/)).toBeTruthy();
  fireEvent.click(within(screen.getByRole("region", { name: copy.reactionMessage(42) })).getByRole("button", { name: /^Close/ }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /Firing 1/ })));
  expect(app.calls.filter(call => call.method === "reaction.run" || call.method === "message.send")).toHaveLength(0);
});

it.each(["acknowledged", "failed"] as const)("nr9_%s_older_submit_preserves_newer_revision_and_navigation", async outcome => {
  const { app, connected } = await mount(() => []);
  const destination = { surface: "reactions", object: "create", recipient: null };
  await connected.drafts.edit(destination, {
    operation: "original", name: "Original", target: "a", instruction: "old exact words", kind: "agents", ids: ["a"], any: false,
    repository: "", number: "", atDate: "", atTime: "", atOffset: "Z", expDate: "2026-10-21", expTime: "09:00", expOffset: "Z", maxFirings: "1", rearm: false,
  }, null, "ordinary").retained;
  app.handlers["reaction.preview"] = () => ({ at: "2026-10-21T09:00:00Z", utc: "2026-10-21T09:00:00Z", offset: "Z" });
  let acknowledge!: (reaction: Reaction) => void;
  let refuse!: (error: Error) => void;
  app.handlers["reaction.create"] = () => new Promise((resolve, reject) => { acknowledge = resolve; refuse = reject; });
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  const save = screen.getByRole("button", { name: copy.reactionSave });
  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  fireEvent.click(save);
  await waitFor(() => expect(app.calls.some(call => call.method === "reaction.create")).toBe(true));
  expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", "old exact words");
  fireEvent.input(screen.getByLabelText(copy.reactionInstruction), { target: { value: " newer\n exact 🧭 " } });

  if (outcome === "acknowledged") acknowledge(saved());
  else refuse(new RpcError(-32602, "old refusal"));
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));
  expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", " newer\n exact 🧭 ");
  expect(connected.drafts.list().at(-1)?.value.operation).not.toBe("original");
  fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Ship it") })).getByRole("button", { name: /^Close/ }));
  fireEvent.click(screen.getByRole("button", { name: copy.reactionCreate }));
  expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", " newer\n exact 🧭 ");
});


it("nr9_reload_and_project_switch_keep_the_original_recipient_without_sending", async () => {
  const first = await mount(() => []);
  const path = first.connected.project.path;
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  fireEvent.input(screen.getByLabelText(copy.reactionInstruction), { target: { value: " original e\u0301\n 🧭 " } });
  fireEvent.click(screen.getByRole("button", { name: /^Target Agent/ }));
  fireEvent.click(await screen.findByRole("option", { name: "a" }));
  await waitFor(() => expect(first.connected.drafts.list().at(-1)?.value.target).toBe("a"));
  first.unmount();
  const other = await mountAskBar([], null, [agent("a", "idle", "ready")]);
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", "");
  other.unmount();
  const reopened = await mountAskBar([], null, [agent("replacement", "idle", "ready", { name: "a" })], false, path);
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", " original e\u0301\n 🧭 ");
  expect(reopened.connected.drafts.list().at(-1)?.value.target).toBe("a");
  expect([...first.app.calls, ...other.app.calls, ...reopened.app.calls].filter(call => call.method === "reaction.create" || call.method === "reaction.run")).toHaveLength(0);
});

it("nr9_saved_reactions_remain_inspectable_after_the_last_agent_is_removed", async () => {
  const { app } = await mountAskBar([], null, []);
  app.handlers["reaction.list"] = () => [saved()];
  app.handlers["reaction.get"] = () => saved();
  window.dispatchEvent(new Event("focus"));
  fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
  const detail = await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });
  expect(within(detail).getByText(copy.reactionGone())).toBeTruthy();
  expect(app.calls.filter(call => call.method === "reaction.run" || call.method === "agent.spawn")).toHaveLength(0);
});

it("nr9_can_select_the_existing_supervisor_without_starting_it", async () => {
  const { app } = await mountAskBar([], null, [door("lead", "idle", "ready", { name: "Supervisor" })]);
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  fireEvent.click(screen.getByRole("button", { name: /^Target Agent/ }));
  fireEvent.click(await screen.findByRole("option", { name: "Supervisor" }));
  const preview = screen.getByRole("region", { name: copy.reactionPreview });
  await within(preview).findByText("Supervisor");
  expect(within(preview).getByText(copy.reactionNoHome)).toBeTruthy();

  expect(app.calls.filter(call => call.method === "agent.spawn" || call.method === "agent.run")).toHaveLength(0);
});


it.each(["back", "edit"])("nr9_acknowledgement_refreshes_the_list_after_%s", async action => {
  let list: Reaction[] = [];
  const { app, connected } = await mount(() => list);
  await connected.drafts.edit({ surface: "reactions", object: "create", recipient: null }, {
    operation: "original", name: "Original", target: "a", instruction: "old exact words", kind: "agents", ids: ["a"], any: false,
    repository: "", number: "", atDate: "", atTime: "", atOffset: "Z", expDate: "2026-10-21", expTime: "09:00", expOffset: "Z", maxFirings: "1", rearm: false,
  }, null, "ordinary").retained;
  app.handlers["reaction.preview"] = () => ({ at: "2026-10-21T09:00:00Z", utc: "2026-10-21T09:00:00Z", offset: "Z" });
  let acknowledge!: (reaction: Reaction) => void;
  app.handlers["reaction.create"] = () => new Promise(resolve => { acknowledge = resolve; });
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  const save = screen.getByRole("button", { name: copy.reactionSave });
  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  fireEvent.click(save);
  await waitFor(() => expect(app.calls.some(call => call.method === "reaction.create")).toBe(true));

  if (action === "back") fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Ship it") })).getByRole("button", { name: /^Close/ }));
  else fireEvent.input(screen.getByLabelText(copy.reactionInstruction), { target: { value: "new words" } });
  list = [saved()];
  acknowledge(list[0]!);
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));

  if (action === "edit") fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Ship it") })).getByRole("button", { name: /^Close/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
  const detail = await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });
  expect(within(detail).getByRole("button", { name: copy.reactionStop })).toHaveProperty("disabled", false);
});

it.each([
  { error: new Error("connection lost"), kind: "agents", reload: false },
  { error: new RpcError(-32603, "internal error"), kind: "pr-checks", reload: false },
  { error: new RpcError(-32004, "reply lost"), kind: "instant", reload: true },
])("nr9_unknown_creation_reconciles_original_operation_before_newer_submit_$kind", async ({ error, kind, reload }) => {
  const first = await mount(() => []);
  let { app, connected } = first;
  await connected.drafts.edit({ surface: "reactions", object: "create", recipient: null }, {
    operation: "original", name: "Original", target: "a", instruction: "old exact words", kind, ids: ["a"], any: false,
    repository: "o/r", number: "7", atDate: "2026-10-21", atTime: "09:00", atOffset: "Z", expDate: "2026-10-21", expTime: "09:00", expOffset: "Z", maxFirings: "1", rearm: false,
  }, null, "ordinary").retained;
  app.handlers["reaction.preview"] = () => ({ at: "2026-10-21T09:00:00Z", utc: "2026-10-21T09:00:00Z", offset: "Z" });
  app.handlers["reaction.create"] = () => { throw error; };

  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  const save = screen.getByRole("button", { name: copy.reactionSave });
  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  fireEvent.click(save);
  await waitFor(() => expect(app.calls.some(call => call.method === "reaction.create")).toBe(true));
  await screen.findByText(/Creation acceptance unknown/);
  expect(connected.drafts.list()[0]?.status).toBe("unknown");
  fireEvent.input(screen.getByLabelText(copy.reactionInstruction), { target: { value: "new words" } });
  expect(save).toHaveProperty("disabled", true);
  const original = app.calls.find(call => call.method === "reaction.create")!.params;

  if (reload) {
    const path = connected.project.path;
    await waitFor(() => expect(localStorage.getItem(`roundup:drafts:${path}`)).toContain("new words"));
    first.unmount();
    const reopened = await mountAskBar([], null, [agent("a", "idle", "ready")], false, path);
    app = reopened.app;
    connected = reopened.connected;
    app.handlers["reaction.preview"] = () => ({ at: "2026-10-21T09:00:00Z", utc: "2026-10-21T09:00:00Z", offset: "Z" });
  } else fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Ship it") })).getByRole("button", { name: /^Close/ }));
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  app.handlers["reaction.create"] = () => saved();
  fireEvent.click(screen.getByRole("button", { name: "Check creation" }));
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "unknown")).toBe(false));
  const sent = app.calls.filter(call => call.method === "reaction.create").map(call => call.params);
  expect(sent).toHaveLength(reload ? 1 : 2);
  expect(sent.at(-1)).toEqual(original);
  expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", "new words");
});


it("nr9_creation_acknowledgement_refreshes_the_remounted_project", async () => {
  const nodes = Array.from({ length: 10 }, (_, index) => agent(`a${index}`, "idle", "ready"));
  const { app } = await openTabs({ original: nodes, other: [agent("b", "idle", "ready")] });
  const original = app.of(path("original"));
  let current: Reaction | null = null;
  original.handlers["reaction.list"] = () => current ? [current] : [];
  original.handlers["reaction.get"] = () => current!;
  original.handlers["reaction.stop"] = () => (current = { ...current!, state: "stopped" });
  original.handlers["reaction.preview"] = () => ({ at: "2026-10-21T09:00:00Z", utc: "2026-10-21T09:00:00Z", offset: "Z" });
  let acknowledge!: (reaction: Reaction) => void;
  original.handlers["reaction.create"] = () => new Promise(resolve => { acknowledge = resolve; });

  fireEvent.click(tab("original"));
  await waitFor(() => expect(document.querySelector('[role="treeitem"][data-id="a0"]')).toBeTruthy());
  openProjectPage("view:reactions");
  const opening = within(await screen.findByRole("region", { name: copy.reactions }));
  fireEvent.click(await opening.findByRole("button", { name: copy.reactionCreate }));
  const form = within(await opening.findByRole("form", { name: copy.reactionCreate }));
  fireEvent.input(form.getByLabelText(copy.reactionName), { target: { value: "Ship it" } });
  fireEvent.input(form.getByLabelText(copy.reactionInstruction), { target: { value: "go" } });
  fireEvent.click(form.getByRole("button", { name: /^Target Agent/ }));
  fireEvent.click(await screen.findByRole("option", { name: "a0" }));
  fireEvent.click(form.getByRole("checkbox", { name: "a0" }));
  fireEvent.input(form.getByLabelText(copy.reactionDate), { target: { value: "2026-10-21" } });
  fireEvent.input(form.getByLabelText(copy.reactionTime), { target: { value: "09:00" } });
  const save = form.getByRole("button", { name: copy.reactionSave });
  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  fireEvent.click(save);
  await waitFor(() => expect(app.calls.some(call => call.method === "reaction.create")).toBe(true));
  await waitFor(() => expect(original.calls.filter(call => call.method === "reaction.create")).toHaveLength(1));

  const newer = "  newer e\u0301\n 日本語 🧭  ";
  fireEvent.input(form.getByLabelText(copy.reactionInstruction), { target: { value: newer } });

  fireEvent.click(tab("other"));
  await waitFor(() => expect(document.querySelector('[role="treeitem"][data-id="b"]')).toBeTruthy());
  openProjectPage("view:reactions");
  await screen.findByText(copy.reactionsEmpty);
  fireEvent.click(tab("original"));
  await waitFor(() => expect(document.querySelector('[role="treeitem"][data-id="a0"]')).toBeTruthy());
  await screen.findByText(copy.reactionsEmpty);
  current = saved({ target: "a0", condition: { kind: "agents", ids: ["a0"], any: false } });
  acknowledge(current);

  const returned = within(await screen.findByRole("region", { name: copy.reactions }));
  fireEvent.click(await returned.findByRole("button", { name: /Ship it/ }));
  const detail = await returned.findByRole("region", { name: copy.reactionDetail("Ship it") });
  fireEvent.click(within(detail).getByRole("button", { name: copy.reactionStop }));
  await waitFor(() => expect(within(detail).getByRole("button", { name: copy.reactionStop })).toHaveProperty("disabled", true));
  expect(original.calls.filter(call => call.method === "reaction.stop").map(call => call.params)).toEqual([{ id: "r1" }]);
  expect(app.of(path("other")).calls.filter(call => call.method === "reaction.create" || call.method === "reaction.stop")).toHaveLength(0);
  expect(original.calls.filter(call => call.method === "reaction.create").map(call => call.params)).toEqual([expect.objectContaining({ target: "a0", instruction: "go" })]);
  fireEvent.click(within(detail).getByRole("button", { name: /^Close/ }));
  fireEvent.click(await returned.findByRole("button", { name: copy.reactionCreate }));
  expect(returned.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", newer);
  expect(original.calls.filter(call => call.method === "reaction.create")).toHaveLength(1);
  fireEvent.click(tab("other"));
  await screen.findByText(copy.reactionsEmpty);
  expect(screen.queryByRole("button", { name: /Ship it/ })).toBeNull();
});

it("u3299b_copy_keeps_original_facts", async () => {
  const record = saved({ observation: { health: "observing", health_code: "observing", cause_code: "unknown", gap_code: "unknown", recovery_code: "unknown", cursor: 918, pinned_head: "commit-original", gap: "gap /Users/test/private agent-id", recovery: "recovery-original", evidence: '{"source":"unknown","id":"original"}' } });
  const write = vi.fn().mockResolvedValue(undefined);

  try {
    const { app } = await mount(() => [record]);
    vi.spyOn(app, "clipboardWrite").mockImplementation(write);
    fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
    const detail = await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });
    fireEvent.click(within(detail).getByRole("button", { name: copy.refresh }));
    await waitFor(() => expect(app.calls.filter(call => call.method === "reaction.get")).toHaveLength(2));
    expect(write).not.toHaveBeenCalled();
    fireEvent.click(within(detail).getByRole("button", { name: copy.copy }));
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(JSON.parse(write.mock.calls[0]![0]).reaction).toEqual(record);
    expect(app.calls.filter(call => call.method === "reaction.run")).toHaveLength(0);
  } finally { vi.unstubAllGlobals(); }
});


it.each(([
  { owner: "action", method: "reaction.run", action: copy.reactionRun },
  { owner: "action", method: "reaction.stop", action: copy.reactionStop },
  { owner: "inspection", method: "reaction.get", action: copy.refresh },
  { owner: "clipboard", method: null, action: copy.copy },
  { owner: "message", method: "message.get", action: copy.retry },
  { owner: "message_clipboard", method: null, action: copy.copy },
] as const).flatMap(row => (["dismiss", "recover", "navigate"] as const).map(transition => ({ ...row, transition }))))("p3557c_failure_lifetime_reactions_$owner ($action, $transition)", async ({ owner, method, action, transition }) => {
  const record = saved({ firings: [{ id: "f1", ordinal: 1, message: 42, matched: true, evidence: "finished", definition: "{}", outcome: "pending" }] });
  const second = saved({ id: "r2", name: "Other reaction", instruction: "other instruction" });
  const { app, connected } = await mount(() => [record, second]);
  await connected.drafts.edit({ surface: "reactions", object: "create", recipient: null }, {
    operation: "unsubmitted", name: "Unfinished", target: "a", instruction: " exact\n e\u0301 🧭 ", kind: "agents", ids: ["a"], any: false,
    repository: "", number: "", atDate: "", atTime: "", atOffset: "Z", expDate: "", expTime: "", expOffset: "Z", maxFirings: "1", rearm: false,
  }, null, "ordinary").retained;
  const retained = structuredClone(connected.drafts.list());
  const message: Message = { id: 42, from: { kind: "user", id: "u", parent: null }, to: "a", body: "accepted exact instruction", kind: "note", replyTo: null, status: "dropped", reason: "receiver gone", at: 0 };
  app.handlers["message.get"] = () => message;
  const write = vi.fn().mockRejectedValue(new Error("clipboard unavailable"));
  vi.spyOn(app, "clipboardWrite").mockImplementation(write);

  try {
    fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
    await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });
    await waitFor(() => expect(app.calls.filter(call => call.method === "reaction.get")).toHaveLength(1));
    const fail = () => { throw new Error("request refused"); };

    if (owner === "message" || owner === "message_clipboard") {
      if (owner === "message") app.handlers["message.get"] = fail;
      fireEvent.click(screen.getByRole("button", { name: /Firing 1/ }));

      if (owner === "message_clipboard") await screen.findByText("accepted exact instruction");
    }

    if (method && owner !== "message") app.handlers[method] = fail;

    if (owner !== "message") fireEvent.click(screen.getByRole("button", { name: action }));
    const failure = owner.includes("clipboard") ? copy.copyDraftFailure("clipboard unavailable") : "request refused";
    await screen.findByRole("alert", { name: failure });

    if (transition === "dismiss") {
      const calls = app.calls.length;

      fireEvent.click(screen.getByRole("button", { name: copy.clear }));
      expect(screen.queryByRole("alert", { name: failure })).toBeNull();
      expect(app.calls).toHaveLength(calls);
    } else if (transition === "recover") {
      if (method === "message.get") app.handlers[method] = () => message;
      else if (method) app.handlers[method] = () => record;
      else write.mockResolvedValue(undefined);

      await waitFor(() => expect(screen.getByRole("button", { name: action })).toHaveProperty("disabled", false));
      fireEvent.click(screen.getByRole("button", { name: action }));
      await waitFor(() => expect(screen.queryByRole("alert", { name: failure })).toBeNull());
    } else {
      if (owner.startsWith("message")) {
        fireEvent.click(within(screen.getByRole("region", { name: copy.reactionMessage(42) })).getByRole("button", { name: /^Close/ }));
        expect(screen.queryByRole("alert", { name: failure })).toBeNull();
      }

      fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Ship it") })).getByRole("button", { name: /^Close/ }));
      fireEvent.click(await screen.findByRole("button", { name: /Other reaction/ }));
      await screen.findByText("other instruction");
      expect(screen.queryByRole("alert", { name: failure })).toBeNull();
    }

    expect(connected.drafts.list()).toEqual(retained);
    expect(app.calls.filter(call => call.method === "reaction.create" || call.method === "message.send")).toHaveLength(0);

    for (const call of app.calls.filter(call => call.method === "reaction.run" || call.method === "reaction.stop")) expect(call.params).toMatchObject({ id: "r1" });
  } finally { vi.unstubAllGlobals(); }
});


it.each(["dismiss", "recover"])("p3557c_failure_lifetime_reactions_list_%s", async transition => {
  const { app, connected } = await mount(() => [saved()]);
  await screen.findByRole("button", { name: /Ship it/ });
  const before = structuredClone(connected.drafts.list());
  app.handlers["reaction.list"] = () => { throw new Error("list unavailable"); };

  window.dispatchEvent(new Event("focus"));
  await screen.findByRole("alert", { name: "list unavailable" });
  fireEvent.click(screen.getByRole("button", { name: /Ship it/ }));
  await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });
  fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Ship it") })).getByRole("button", { name: /^Close/ }));
  expect(screen.getByRole("alert")).toBeTruthy();

  if (transition === "recover") app.handlers["reaction.list"] = () => [saved()];
  fireEvent.click(screen.getByRole("button", { name: transition === "dismiss" ? copy.clear : copy.retry }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(connected.drafts.list()).toEqual(before);
  expect(screen.getByRole("button", { name: /Ship it/ })).toBeTruthy();
});

it.each(["refused", "unknown", "retention"] as const)("p3557c_failure_lifetime_reactions_creation_%s", async outcome => {
  const { app, connected } = await mount(() => []);
  app.handlers["reaction.preview"] = () => ({ at: "2026-10-21T09:00:00Z", utc: "2026-10-21T09:00:00Z", offset: "Z" });
  await connected.drafts.edit({ surface: "reactions", object: "create", recipient: null }, {
    operation: "original", name: "Original", target: "a", instruction: " exact\n e\u0301 🧭 ", kind: "agents", ids: ["a"], any: false,
    repository: "", number: "", atDate: "", atTime: "", atOffset: "Z", expDate: "2026-10-21", expTime: "09:00", expOffset: "Z", maxFirings: "1", rearm: false,
  }, null, "ordinary").retained;
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  const save = screen.getByRole("button", { name: copy.reactionSave });
  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  const storage = outcome === "retention" ? vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage full"); }) : null;
  app.handlers["reaction.create"] = () => { throw outcome === "unknown" ? new Error("reply lost") : new RpcError(-32602, "not authorized"); };

  try {
    fireEvent.click(save);
  await waitFor(() => expect(app.calls.some(call => call.method === "reaction.create")).toBe(true));
    await screen.findByRole("alert", { name: outcome === "retention" ? /Could not store unfinished work/ : outcome === "unknown" ? /Creation acceptance unknown/ : copy.reactionNotCreated("not authorized") });
    const retained = structuredClone(connected.drafts.list());

    if (outcome === "refused") {
      fireEvent.click(screen.getByRole("button", { name: copy.clear }));
      expect(screen.queryByRole("alert")).toBeNull();
    } else {
      expect(screen.queryByRole("button", { name: copy.clear })).toBeNull();
      expect(screen.getByRole("button", { name: outcome === "unknown" ? copy.reactionCheckCreation : copy.storageRetry })).toBeTruthy();
    }

    expect(connected.drafts.list()).toEqual(retained);
    expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", " exact\n e\u0301 🧭 ");
    expect(connected.drafts.list().at(-1)).toMatchObject({ destination: { surface: "reactions", object: "create", recipient: null }, value: { target: "a", operation: "original" } });
    expect(app.calls.filter(call => call.method === "reaction.create")).toHaveLength(1);
  } finally { storage?.mockRestore(); }
});

it.each(["dismiss", "recover"])("p3557c_failure_lifetime_reactions_clipboard_identity_%s", async transition => {
  const record = saved({ firings: [{ id: "f1", ordinal: 1, message: 42, matched: true, evidence: "finished", definition: "{}", outcome: "pending" }] });
  const { app, connected } = await mount(() => [record]);
  const retained = structuredClone(connected.drafts.list());
  app.handlers["message.get"] = () => ({ id: 42, from: { kind: "user", id: "u", parent: null }, to: "a", body: "different accepted instruction", kind: "note", replyTo: null, status: "pending", reason: null, at: 0 });
  const write = vi.fn().mockRejectedValue(new Error("reaction clipboard unavailable"));
  vi.spyOn(app, "clipboardWrite").mockImplementation(write);

  try {
    fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
    fireEvent.click(await screen.findByRole("button", { name: copy.copy }));
    await screen.findByRole("alert", { name: /reaction clipboard unavailable/ });
    fireEvent.click(screen.getByRole("button", { name: /Firing 1/ }));
    await screen.findByText("different accepted instruction");
    expect(screen.queryByRole("alert", { name: /reaction clipboard unavailable/ })).toBeNull();
    write.mockRejectedValue(new Error("message clipboard unavailable"));
    fireEvent.click(screen.getByRole("button", { name: copy.copy }));
    await screen.findByRole("alert", { name: /message clipboard unavailable/ });

    if (transition === "recover") write.mockResolvedValue(undefined);

    fireEvent.click(screen.getByRole("button", { name: transition === "recover" ? copy.copy : copy.clear }));
    await waitFor(() => expect(screen.queryByRole("alert", { name: /message clipboard unavailable/ })).toBeNull());
    fireEvent.click(within(screen.getByRole("region", { name: copy.reactionMessage(42) })).getByRole("button", { name: /^Close/ }));
    expect(screen.getByRole("alert", { name: /reaction clipboard unavailable/ })).toBeTruthy();
    expect(connected.drafts.list()).toEqual(retained);
    expect(app.calls.filter(call => call.method === "message.get").map(call => call.params)).toEqual([{ id: 42 }]);
    expect(app.calls.filter(call => call.method === "reaction.create" || call.method === "reaction.run" || call.method === "message.send")).toHaveLength(0);
  } finally { vi.unstubAllGlobals(); }
});

it.each(["dismiss", "unrelated acknowledgement"])("p3557c_failure_lifetime_reactions_action_identity_%s", async transition => {
  const record = saved({ observation: { health: "unavailable", health_code: "unavailable", cause_code: "evidence-missing", gap_code: "unknown", recovery_code: "check", cursor: null, gap: null, recovery: null, evidence: null, cause: "no required-check evidence" } });
  const second = saved({ id: "r2", name: "Other reaction" });
  const { app, connected } = await mount(() => [record, second]);
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  fireEvent.input(screen.getByLabelText(copy.reactionInstruction), { target: { value: " keep exactly\n 🧭 " } });
  const retained = structuredClone(connected.drafts.list());

  fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Ship it") })).getByRole("button", { name: /^Close/ }));
  app.handlers["reaction.run"] = ({ id }) => {
    if (id === "r1") throw new Error("first reaction refused");

    return second;
  };

  fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
  const observationFailure = (await screen.findByRole("alert")).getAttribute("aria-label") ?? "";

  fireEvent.click(screen.getByRole("button", { name: copy.reactionRun }));
  await screen.findByRole("alert", { name: "first reaction refused" });

  if (transition === "dismiss") fireEvent.click(screen.getByRole("button", { name: copy.clear }));
  else {
    await waitFor(() => expect(screen.getByRole("button", { name: copy.reactionRun })).toHaveProperty("disabled", false));
    fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Ship it") })).getByRole("button", { name: /^Close/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Other reaction/ }));
    fireEvent.click(screen.getByRole("button", { name: copy.reactionRun }));
    await waitFor(() => expect(screen.getByRole("button", { name: copy.reactionRun })).toHaveProperty("disabled", false));
    fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Other reaction") })).getByRole("button", { name: /^Close/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
  }

  expect(screen.queryByRole("alert", { name: "first reaction refused" }) !== null).toBe(transition !== "dismiss");
  expect(screen.getByRole("alert", { name: observationFailure })).toBeTruthy();
  expect(connected.drafts.list()).toEqual(retained);
});

const observeFailure = async (observation: Reaction["observation"]) => {
  const record = saved({ observation });
  const { app } = await mount(() => [record]);
  fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
  const text = (await screen.findByRole("alert")).textContent;

  const controls = [copy.refresh, copy.reactionStop, copy.reactionRun].map(name => ({
    name, disabled: screen.getByRole("button", { name }).hasAttribute("disabled"),
  }));

  expect(app.calls.filter(call => call.method === "reaction.run" || call.method === "message.send")).toHaveLength(0);
  cleanup();

  return { text, controls };
};

it.each([
  ["head-moved", "unknown"], ["unsupported", "head-moved"], ["unknown", "unsupported"],
] as const)("u3791b_copy_depends_on_codes_not_messages_reactions_%s", async (code, otherCode) => {
  const observation = (cause_code: typeof code | typeof otherCode, cause: string): Reaction["observation"] => ({
    health: "unavailable", health_code: "unavailable", cause_code, gap_code: "unknown", recovery_code: "check", cursor: 19, gap: null, recovery: "same diagnostic", evidence: null, cause,
  });

  const diagnostic = "the PR head moved from a to b";
  const baseline = await observeFailure(observation(code, diagnostic));

  for (const changed of ["unsupported /private/diagnostic", ""]) {
    expect(await observeFailure(observation(code, changed))).toEqual(baseline);
  }

  expect((await observeFailure(observation(otherCode, diagnostic))).text).not.toBe(baseline.text);
});

it.each([
  ["history-expired", "reconciled", "agent-unavailable", "replace-agent"],
  ["agent-unavailable", "replace-agent", "unknown", "unknown"],
  ["unknown", "unknown", "history-expired", "reconciled"],
] as const)("u3791b_copy_depends_on_codes_not_messages_reaction_gaps_%s", async (gap, recovery, otherGap, otherRecovery) => {
  const observation = (gap_code: typeof gap | typeof otherGap, recovery_code: typeof recovery | typeof otherRecovery, diagnostic: string): Reaction["observation"] => ({
    health: "observing", health_code: "observing", cause_code: "unknown", gap_code, recovery_code, cursor: 99, gap: diagnostic, recovery: diagnostic, evidence: null,
  });

  const diagnostic = "the Event history after 88 expired";
  const baseline = await observeFailure(observation(gap, recovery, diagnostic));
  expect(await observeFailure(observation(gap, recovery, "unrecognized /private/history"))).toEqual(baseline);
  expect((await observeFailure(observation(otherGap, recovery, diagnostic))).text).not.toBe(baseline.text);
  expect((await observeFailure(observation(gap, otherRecovery, diagnostic))).text).not.toBe(baseline.text);
});

it("u4276a_close_preserves_unsent_reaction", async () => {
  const { app, connected } = await mount(() => []);
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  fireEvent.input(screen.getByLabelText(copy.reactionName), { target: { value: " Unsent 🧭 " } });
  fireEvent.input(screen.getByLabelText(copy.reactionInstruction), { target: { value: " exact\n e\u0301 " } });
  const before = structuredClone(connected.drafts.list().at(-1));
  fireEvent.click(screen.getByRole("button", { name: "Close New reaction" }));
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", " exact\n e\u0301 ");
  expect(connected.drafts.list().at(-1)).toEqual(before);
  expect(app.calls.filter(call => call.method === "reaction.create" || call.method === "reaction.run")).toHaveLength(0);
});

it("u4276c_empty_list_offers_first_creation", async () => {
  await mount(() => []);
  const create = await screen.findByRole("button", { name: copy.reactionCreate });
  expect(screen.getAllByRole("button", { name: copy.reactionCreate })).toHaveLength(1);
  fireEvent.click(create);
  await screen.findByRole("form", { name: copy.reactionCreate });
  fireEvent.click(screen.getByRole("button", { name: "Close New reaction" }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: copy.reactionCreate })));
});

it("u4276c_list_opens_exact_reaction", async () => {
  const { app } = await mount(() => [saved({ home: "alpha" }), saved({ id: "r2", home: "beta", instruction: "second" })], [workstream("alpha"), workstream("beta")]);
  fireEvent.click(await screen.findByRole("button", { name: /Ship it.*beta/ }));
  await screen.findByText("second");
  expect(app.calls.filter(call => call.method === "reaction.get").map(call => call.params)).toEqual([{ id: "r2" }]);
  fireEvent.click(screen.getByRole("button", { name: "Close Ship it" }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /Ship it.*beta/ })));
});

it("u4276b_form_groups_and_keyboard_controls", async () => {
  await mount(() => []);
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  const form = screen.getByRole("form", { name: copy.reactionCreate });
  expect(within(form).getByRole("group", { name: "What to send" }).contains(screen.getByLabelText(copy.reactionName))).toBe(true);
  const conditions = within(form).getByRole("group", { name: "When to send" });
  fireEvent.click(within(conditions).getByRole("checkbox", { name: "a" }));
  expect(within(conditions).getByRole("checkbox", { name: "a" })).toHaveProperty("checked", true);
  const sendWhen = within(conditions).getByRole("radiogroup", { name: "Send when" });
  fireEvent.click(within(sendWhen).getByRole("radio", { name: "Any selected Agent finishes" }));
  expect(within(sendWhen).getByRole("radio", { name: "Any selected Agent finishes" })).toHaveProperty("checked", true);
});

it.each(["Z", "-05:00", "+05:30"])("u4276b_time_choice_uses_exact_preview: %s", async offset => {
  const { app, connected } = await mount(() => []);
  app.handlers["reaction.preview"] = params => ({ at: params.date === "2030-01-01" ? "2030-01-01T12:00:00Z" : "2030-01-02T12:00:00Z", utc: "2030-01-01T12:00:00Z", offset: params.offset });
  app.handlers["reaction.create"] = () => saved();
  await connected.drafts.edit({ surface: "reactions", object: "create", recipient: null }, {
    operation: "zone", name: "time", target: "a", instruction: "exact", kind: "instant", ids: [], any: false, repository: "", number: "",
    atDate: "2030-01-01", atTime: "12:00", atOffset: offset, expDate: "2030-01-02", expTime: "12:00", expOffset: offset, maxFirings: "1", rearm: false,
  }, null, "ordinary").retained;
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  const submit = screen.getByRole("button", { name: copy.reactionSave });
  await waitFor(() => expect(submit).toHaveProperty("disabled", false));
  fireEvent.click(submit);
  await waitFor(() => expect(app.calls.filter(call => call.method === "reaction.create")).toHaveLength(1));
  expect(app.calls.filter(call => call.method === "reaction.preview").map(call => call.params)).toEqual(expect.arrayContaining([
    { date: "2030-01-01", time: "12:00", offset }, { date: "2030-01-02", time: "12:00", offset },
  ]));
  expect(app.calls.find(call => call.method === "reaction.create")?.params).toMatchObject({ condition: { kind: "instant", at: "2030-01-01T12:00:00Z" }, expires_at: "2030-01-02T12:00:00Z" });
});

const openings = [
  { opening: "Project menu → Reactions", detail: false },
  { opening: "Reactions → detail → list", detail: true },
];

const mountList = async (detail: boolean) => {
  localStorage.clear();
  const records = ["alpha", "same é 🧭", "same é 🧭", "delta", "終 é 🧭", "hidden", "disabled", "folded"].map((name, at) => saved({ id: `r${at}`, name, home: at === 2 ? "other-home" : null, target: at === 2 ? "b" : "a" }));
  const app = createFakeApp();
  app.opened.project = { path: "/p", name: "Project" };
  app.handlers["rail.tree"] = () => [workstream("other-home", { name: "Other Home", status: null }), agent("a", "idle", "ready"), agent("b", "idle", "ready", { parent: "other-home" })];
  app.handlers["terminal.list"] = () => [];
  app.handlers["reaction.list"] = () => records;
  app.handlers["reaction.get"] = ({ id }) => records.find(record => record.id === id)!;
  const { factory } = fakeEmulators();
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} createEmulator={factory} />);
  await screen.findByRole("region", { name: "Project overview" });
  openProjectPage("view:reactions", "/p");
  await waitFor(() => expect(document.querySelectorAll(".reaction-row")).toHaveLength(8));

  if (detail) {
    fireEvent.click(document.querySelectorAll(".reaction-row")[2]!);
    await screen.findByRole("region", { name: copy.reactionDetail(records[2]!.name) });
    fireEvent.click(screen.getByRole("button", { name: copy.closeView(records[2]!.name) }));
    await waitFor(() => expect(document.activeElement).toBe(document.querySelectorAll(".reaction-row")[2]));
  }

  const rows = [...document.querySelectorAll<HTMLButtonElement>(".reaction-row")];
  rows[5]!.hidden = true;
  rows[6]!.disabled = true;
  rows[7]!.closest("li")!.setAttribute("inert", "");

  return { app, rows, records };
};

const selectedRows = (rows: HTMLButtonElement[]) => rows.filter(row => row.dataset.rowSelected === "true");

it.each(openings)("u3787c_each_list_navigates_visible_rows $opening", async ({ detail }) => {
  const { app, rows } = await mountList(detail);
  const before = app.calls.length;
  rows[1]!.focus();

  for (const [key, at] of [["Home", 0], ["ArrowUp", 0], ["End", 4], ["ArrowDown", 4], ["ArrowUp", 3], ["ArrowDown", 4], ["a", 0], ["l", 0]] as const) {
    fireEvent.keyDown(document.activeElement!, { key });
    expect(document.activeElement).toBe(rows[at]);
  }

  expect(selectedRows(rows)).toEqual([rows[0]]);
  expect(app.calls.slice(before)).toEqual([]);
  expect(document.querySelector(".reaction-detail, .todo-drawer")).toBeNull();
});

it.each(openings)("u3787c_each_list_selects_only_visible_rows $opening", async ({ detail }) => {
  const { app, rows: r } = await mountList(detail);
  const before = app.calls.length;
  fireEvent.click(r[1]!, { shiftKey: true });
  expect(selectedRows(r)).toEqual([r[1]]);
  fireEvent.click(r[4]!, { metaKey: true, shiftKey: true });
  expect(selectedRows(r)).toEqual([r[4]]);
  fireEvent.click(r[1]!, { metaKey: true });
  expect(selectedRows(r)).toEqual([r[1], r[4]]);
  fireEvent.click(r[3]!, { shiftKey: true });
  expect(selectedRows(r)).toEqual([r[1], r[2], r[3]]);
  fireEvent.click(r[2]!, { metaKey: true });
  expect(selectedRows(r)).toEqual([r[1], r[3]]);
  fireEvent.click(r[4]!, { metaKey: true, shiftKey: true });
  expect(selectedRows(r)).toEqual([r[2], r[3], r[4]]);
  fireEvent.keyDown(r[4]!, { key: "a", metaKey: true });
  expect(selectedRows(r)).toEqual(r.slice(0, 5));
  r[1]!.hidden = true;
  fireEvent.keyDown(r[4]!, { key: "a", metaKey: true });
  expect(selectedRows(r)).toEqual([r[0], r[2], r[3], r[4]]);
  expect(app.calls.slice(before)).toEqual([]);
  expect(app.openedTargets).toEqual([]);
  expect(document.querySelector(".reaction-detail, .todo-drawer")).toBeNull();
});

it.each(["Enter", " ", "click"])("u3787c_reaction_activation_preserves_identity_and_list_lifetime_%s", async key => {
  const { app, rows, records } = await mountList(false);
  fireEvent.click(rows[1]!, { metaKey: true });
  rows[2]!.focus();
  const before = app.calls.length;

  if (key === "click") fireEvent.click(rows[2]!);
  else fireEvent.keyDown(rows[2]!, { key });
  await screen.findByRole("region", { name: copy.reactionDetail(records[2]!.name) });
  await waitFor(() => expect(app.calls.slice(before)).toEqual([{ method: "reaction.get", params: { id: "r2" } }]));
  fireEvent.click(screen.getByRole("button", { name: copy.closeView(records[2]!.name) }));
  await waitFor(() => expect(document.activeElement).toBe(document.querySelectorAll(".reaction-row")[2]));
  expect(selectedRows([...document.querySelectorAll<HTMLButtonElement>(".reaction-row")]).map(row => row.dataset.reactionOpener)).toEqual(["r1"]);
});

it("u3787c_reaction_form_keeps_editor_key_ownership", async () => {
  const { app } = await mountList(false);
  fireEvent.click(screen.getByRole("button", { name: copy.reactionCreate }));
  const field = await screen.findByLabelText(copy.reactionInstruction);
  const exact = "  é 🧭\n original target  ";
  fireEvent.input(field, { target: { value: exact } });
  field.focus();
  const before = app.calls.length;

  for (const key of ["ArrowDown", "Home", "End", "a"]) {
    expect(fireEvent.keyDown(field, { key, metaKey: key === "a" })).toBe(true);
    expect(document.activeElement).toBe(field);
  }

  expect(field).toHaveProperty("value", exact);
  expect(app.calls.slice(before)).toEqual([]);
  expect(document.querySelector(".reaction-detail")).toBeNull();
});
