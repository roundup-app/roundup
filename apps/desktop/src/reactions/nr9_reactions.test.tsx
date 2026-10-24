import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
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
  observation: { health: "observing", cursor: null, gap: null, recovery: null, evidence: null }, firings: [], ...patch,
});

const mount = async (list: () => Reaction[]) => {
  const mounted = await mountAskBar([], null, [agent("a", "idle", "ready")]);

  mounted.app.handlers["reaction.list"] = list;
  mounted.app.handlers["reaction.get"] = ({ id }) => list().find(reaction => reaction.id === id)!;
  window.dispatchEvent(new Event("focus"));

  return mounted;
};

it("nr9_create_inspect_stop_run_and_focus", async () => {
  let current = saved();
  const { app } = await mount(() => [current]);
  const row = await screen.findByRole("button", { name: /Ship it/ });

  row.focus();
  fireEvent.click(row);
  const detail = await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });

  expect(within(detail).getByText("go")).toBeTruthy();
  expect(app.calls.map((call) => call.method)).not.toContain("reaction.run");
  app.handlers["reaction.stop"] = () => (current = saved({ state: "stopped" }));
  app.handlers["reaction.run"] = () => current;
  fireEvent.click(within(detail).getByRole("button", { name: copy.reactionRun }));
  await waitFor(() => expect(app.calls.filter((call) => call.method === "reaction.run")).toHaveLength(1));
  await waitFor(() => expect(within(detail).getByRole("button", { name: copy.reactionStop })).toHaveProperty("disabled", false));
  fireEvent.click(within(detail).getByRole("button", { name: copy.reactionStop }));
  await waitFor(() => expect(within(detail).getByRole("button", { name: copy.reactionRun })).toHaveProperty("disabled", true));
  fireEvent.click(within(detail).getByRole("button", { name: copy.close }));
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

  connected.drafts.edit(destination, value, null, "ordinary");
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
  connected.drafts.edit({ surface: "reactions", object: "create", recipient: null }, {
    operation: "op-overlap", name: "Ship it", target: "", instruction: "go", kind: "agents", ids: [], any: false,
    repository: "", number: "", atDate: "", atTime: "", atOffset: "Z", expDate: "2026-10-21", expTime: "09:00", expOffset: "Z",
    maxFirings: "1", rearm: false,
  }, null, "ordinary");
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  fireEvent.click(screen.getByRole("combobox", { name: copy.reactionTarget }));
  fireEvent.click(await screen.findByRole("option", { name: "Builder · Check" }));
  const preview = screen.getByRole("region", { name: copy.reactionPreview });

  await within(preview).findByText("Builder · Check");
  fireEvent.click(screen.getByRole("checkbox", { name: "Builder · Build" }));
  await within(preview).findByText(/All of Builder · Build finish/);
  const save = screen.getByRole("button", { name: copy.reactionSave });

  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  fireEvent.click(save);
  const detail = await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });

  expect(app.calls.find((call) => call.method === "reaction.create")?.params).toMatchObject({ target: "b", condition: { ids: ["a"] } });
  expect(within(detail).getByText("Builder · Check")).toBeTruthy();
  expect(within(detail).getByText(/All of Builder · Build finish/)).toBeTruthy();
});

it("nr9_firing_opens_only_its_recorded_message_and_returns_focus", async () => {
  const { app } = await mount(() => [saved({ firings: [{ id: "f1", ordinal: 1, message: 42, matched: true, evidence: "finished", definition: "{}", outcome: "held" }] })]);
  app.handlers["message.get"] = () => ({ id: 42, from: { kind: "user", id: "u", parent: null }, to: "a", body: "exact accepted instruction", kind: "note", replyTo: null, status: "dropped", reason: "receiver gone", passedFrom: null, at: 0 });
  fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
  const link = await screen.findByRole("button", { name: /Firing 1/ });
  fireEvent.click(link);
  await screen.findByText("exact accepted instruction");
  expect(app.calls.filter(call => call.method === "message.get").map(call => call.params)).toEqual([{ id: 42 }]);
  expect(screen.getByText(/Not delivered/)).toBeTruthy();
  fireEvent.click(within(screen.getByRole("region", { name: copy.reactionMessage(42) })).getByRole("button", { name: copy.close }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /Firing 1/ })));
  expect(app.calls.filter(call => call.method === "reaction.run" || call.method === "message.send")).toHaveLength(0);
});

it.each(["acknowledged", "failed"] as const)("nr9_%s_older_submit_preserves_newer_revision_and_navigation", async outcome => {
  const { app, connected } = await mount(() => []);
  const destination = { surface: "reactions", object: "create", recipient: null };
  connected.drafts.edit(destination, {
    operation: "original", name: "Original", target: "a", instruction: "old exact words", kind: "agents", ids: ["a"], any: false,
    repository: "", number: "", atDate: "", atTime: "", atOffset: "Z", expDate: "2026-10-21", expTime: "09:00", expOffset: "Z", maxFirings: "1", rearm: false,
  }, null, "ordinary");
  app.handlers["reaction.preview"] = () => ({ at: "2026-10-21T09:00:00Z", utc: "2026-10-21T09:00:00Z", offset: "Z" });
  let acknowledge!: (reaction: Reaction) => void;
  let refuse!: (error: Error) => void;
  app.handlers["reaction.create"] = () => new Promise((resolve, reject) => { acknowledge = resolve; refuse = reject; });
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  const save = screen.getByRole("button", { name: copy.reactionSave });
  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  fireEvent.click(save);
  expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", "old exact words");
  fireEvent.input(screen.getByLabelText(copy.reactionInstruction), { target: { value: " newer\n exact 🧭 " } });

  if (outcome === "acknowledged") acknowledge(saved());
  else refuse(new RpcError(-32602, "old refusal"));
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));
  expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", " newer\n exact 🧭 ");
  expect(connected.drafts.list().at(-1)?.value.operation).not.toBe("original");
  fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Ship it") })).getByRole("button", { name: copy.close }));
  fireEvent.click(screen.getByRole("button", { name: copy.reactionCreate }));
  expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", " newer\n exact 🧭 ");
});


it("nr9_reload_and_project_switch_keep_the_original_recipient_without_sending", async () => {
  const first = await mount(() => []);
  const path = first.connected.project.path;
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  fireEvent.input(screen.getByLabelText(copy.reactionInstruction), { target: { value: " original e\u0301\n 🧭 " } });
  fireEvent.click(screen.getByRole("combobox", { name: copy.reactionTarget }));
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
  fireEvent.click(screen.getByRole("combobox", { name: copy.reactionTarget }));
  fireEvent.click(await screen.findByRole("option", { name: "Supervisor" }));
  const preview = screen.getByRole("region", { name: copy.reactionPreview });
  await within(preview).findByText("Supervisor");
  expect(within(preview).getByText(copy.reactionNoHome)).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "Supervisor" })).toBeTruthy();
  expect(app.calls.filter(call => call.method === "agent.spawn" || call.method === "agent.run")).toHaveLength(0);
});


it.each(["back", "edit"])("nr9_acknowledgement_refreshes_the_list_after_%s", async action => {
  let list: Reaction[] = [];
  const { app, connected } = await mount(() => list);
  connected.drafts.edit({ surface: "reactions", object: "create", recipient: null }, {
    operation: "original", name: "Original", target: "a", instruction: "old exact words", kind: "agents", ids: ["a"], any: false,
    repository: "", number: "", atDate: "", atTime: "", atOffset: "Z", expDate: "2026-10-21", expTime: "09:00", expOffset: "Z", maxFirings: "1", rearm: false,
  }, null, "ordinary");
  app.handlers["reaction.preview"] = () => ({ at: "2026-10-21T09:00:00Z", utc: "2026-10-21T09:00:00Z", offset: "Z" });
  let acknowledge!: (reaction: Reaction) => void;
  app.handlers["reaction.create"] = () => new Promise(resolve => { acknowledge = resolve; });
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  const save = screen.getByRole("button", { name: copy.reactionSave });
  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  fireEvent.click(save);

  if (action === "back") fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Ship it") })).getByRole("button", { name: copy.close }));
  else fireEvent.input(screen.getByLabelText(copy.reactionInstruction), { target: { value: "new words" } });
  list = [saved()];
  acknowledge(list[0]!);
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));

  if (action === "edit") fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Ship it") })).getByRole("button", { name: copy.close }));
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
  connected.drafts.edit({ surface: "reactions", object: "create", recipient: null }, {
    operation: "original", name: "Original", target: "a", instruction: "old exact words", kind, ids: ["a"], any: false,
    repository: "o/r", number: "7", atDate: "2026-10-21", atTime: "09:00", atOffset: "Z", expDate: "2026-10-21", expTime: "09:00", expOffset: "Z", maxFirings: "1", rearm: false,
  }, null, "ordinary");
  app.handlers["reaction.preview"] = () => ({ at: "2026-10-21T09:00:00Z", utc: "2026-10-21T09:00:00Z", offset: "Z" });
  app.handlers["reaction.create"] = () => { throw error; };

  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  const save = screen.getByRole("button", { name: copy.reactionSave });
  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  fireEvent.click(save);
  await screen.findByText(/Creation acceptance unknown/);
  expect(connected.drafts.list()[0]?.status).toBe("unknown");
  fireEvent.input(screen.getByLabelText(copy.reactionInstruction), { target: { value: "new words" } });
  expect(save).toHaveProperty("disabled", true);
  const original = app.calls.find(call => call.method === "reaction.create")!.params;

  if (reload) {
    const path = connected.project.path;
    first.unmount();
    const reopened = await mountAskBar([], null, [agent("a", "idle", "ready")], false, path);
    app = reopened.app;
    connected = reopened.connected;
    app.handlers["reaction.preview"] = () => ({ at: "2026-10-21T09:00:00Z", utc: "2026-10-21T09:00:00Z", offset: "Z" });
  } else fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Ship it") })).getByRole("button", { name: copy.close }));
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
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  fireEvent.input(screen.getByLabelText(copy.reactionName), { target: { value: "Ship it" } });
  fireEvent.input(screen.getByLabelText(copy.reactionInstruction), { target: { value: "go" } });
  fireEvent.click(screen.getByRole("combobox", { name: copy.reactionTarget }));
  fireEvent.click(await screen.findByRole("option", { name: "a0" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "a0" }));
  fireEvent.input(screen.getByLabelText(copy.reactionDate), { target: { value: "2026-10-21" } });
  fireEvent.input(screen.getByLabelText(copy.reactionTime), { target: { value: "09:00" } });
  const save = screen.getByRole("button", { name: copy.reactionSave });
  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  fireEvent.click(save);
  await waitFor(() => expect(original.calls.filter(call => call.method === "reaction.create")).toHaveLength(1));

  fireEvent.click(tab("other"));
  await waitFor(() => expect(document.querySelector('[role="treeitem"][data-id="b"]')).toBeTruthy());
  await screen.findByText(copy.reactionsEmpty);
  fireEvent.click(tab("original"));
  await waitFor(() => expect(document.querySelector('[role="treeitem"][data-id="a0"]')).toBeTruthy());
  await screen.findByText(copy.reactionsEmpty);
  current = saved({ target: "a0", condition: { kind: "agents", ids: ["a0"], any: false } });
  acknowledge(current);

  fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
  const detail = await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });
  fireEvent.click(within(detail).getByRole("button", { name: copy.reactionStop }));
  await waitFor(() => expect(within(detail).getByRole("button", { name: copy.reactionStop })).toHaveProperty("disabled", true));
  expect(original.calls.filter(call => call.method === "reaction.stop").map(call => call.params)).toEqual([{ id: "r1" }]);
  expect(app.of(path("other")).calls.filter(call => call.method === "reaction.create" || call.method === "reaction.stop")).toHaveLength(0);
});

it("u3299b_copy_keeps_original_facts", async () => {
  const record = saved({ observation: { health: "observing", cursor: 918, pinned_head: "commit-original", gap: "gap /Users/test/private agent-id", recovery: "recovery-original", evidence: '{"source":"unknown","id":"original"}' } });
  const write = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: write } });

  try {
    const { app } = await mount(() => [record]);
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
  const record = saved({ firings: [{ id: "f1", ordinal: 1, message: 42, matched: true, evidence: "finished", definition: "{}", outcome: "held" }] });
  const second = saved({ id: "r2", name: "Other reaction", instruction: "other instruction" });
  const { app, connected } = await mount(() => [record, second]);
  connected.drafts.edit({ surface: "reactions", object: "create", recipient: null }, {
    operation: "unsubmitted", name: "Unfinished", target: "a", instruction: " exact\n e\u0301 🧭 ", kind: "agents", ids: ["a"], any: false,
    repository: "", number: "", atDate: "", atTime: "", atOffset: "Z", expDate: "", expTime: "", expOffset: "Z", maxFirings: "1", rearm: false,
  }, null, "ordinary");
  const retained = structuredClone(connected.drafts.list());
  const message: Message = { id: 42, from: { kind: "user", id: "u", parent: null }, to: "a", body: "accepted exact instruction", kind: "note", replyTo: null, status: "dropped", reason: "receiver gone", passedFrom: null, at: 0 };
  app.handlers["message.get"] = () => message;
  const write = vi.fn().mockRejectedValue(new Error("clipboard unavailable"));
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: write } });

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
        fireEvent.click(within(screen.getByRole("region", { name: copy.reactionMessage(42) })).getByRole("button", { name: copy.close }));
        expect(screen.queryByRole("alert", { name: failure })).toBeNull();
      }

      fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Ship it") })).getByRole("button", { name: copy.close }));
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
  fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Ship it") })).getByRole("button", { name: copy.close }));
  expect(screen.getByRole("alert", { name: "list unavailable" })).toBeTruthy();

  if (transition === "recover") app.handlers["reaction.list"] = () => [saved()];
  fireEvent.click(screen.getByRole("button", { name: transition === "dismiss" ? copy.clear : copy.retry }));
  await waitFor(() => expect(screen.queryByRole("alert", { name: "list unavailable" })).toBeNull());
  expect(connected.drafts.list()).toEqual(before);
  expect(screen.getByRole("button", { name: /Ship it/ })).toBeTruthy();
});

it.each(["refused", "unknown", "retention"] as const)("p3557c_failure_lifetime_reactions_creation_%s", async outcome => {
  const { app, connected } = await mount(() => []);
  app.handlers["reaction.preview"] = () => ({ at: "2026-10-21T09:00:00Z", utc: "2026-10-21T09:00:00Z", offset: "Z" });
  connected.drafts.edit({ surface: "reactions", object: "create", recipient: null }, {
    operation: "original", name: "Original", target: "a", instruction: " exact\n e\u0301 🧭 ", kind: "agents", ids: ["a"], any: false,
    repository: "", number: "", atDate: "", atTime: "", atOffset: "Z", expDate: "2026-10-21", expTime: "09:00", expOffset: "Z", maxFirings: "1", rearm: false,
  }, null, "ordinary");
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  const save = screen.getByRole("button", { name: copy.reactionSave });
  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  const storage = outcome === "retention" ? vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage full"); }) : null;
  app.handlers["reaction.create"] = () => { throw outcome === "unknown" ? new Error("reply lost") : new RpcError(-32602, "not authorized"); };

  try {
    fireEvent.click(save);
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
  const record = saved({ firings: [{ id: "f1", ordinal: 1, message: 42, matched: true, evidence: "finished", definition: "{}", outcome: "held" }] });
  const { app, connected } = await mount(() => [record]);
  const retained = structuredClone(connected.drafts.list());
  app.handlers["message.get"] = () => ({ id: 42, from: { kind: "user", id: "u", parent: null }, to: "a", body: "different accepted instruction", kind: "note", replyTo: null, status: "held", reason: null, passedFrom: null, at: 0 });
  const write = vi.fn().mockRejectedValue(new Error("reaction clipboard unavailable"));
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: write } });

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
    fireEvent.click(within(screen.getByRole("region", { name: copy.reactionMessage(42) })).getByRole("button", { name: copy.close }));
    expect(screen.getByRole("alert", { name: /reaction clipboard unavailable/ })).toBeTruthy();
    expect(connected.drafts.list()).toEqual(retained);
    expect(app.calls.filter(call => call.method === "message.get").map(call => call.params)).toEqual([{ id: 42 }]);
    expect(app.calls.filter(call => call.method === "reaction.create" || call.method === "reaction.run" || call.method === "message.send")).toHaveLength(0);
  } finally { vi.unstubAllGlobals(); }
});

it.each(["dismiss", "unrelated acknowledgement"])("p3557c_failure_lifetime_reactions_action_identity_%s", async transition => {
  const record = saved({ observation: { health: "unavailable", cursor: null, gap: null, recovery: null, evidence: null, cause: "no required-check evidence" } });
  const second = saved({ id: "r2", name: "Other reaction" });
  const { app, connected } = await mount(() => [record, second]);
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  fireEvent.input(screen.getByLabelText(copy.reactionInstruction), { target: { value: " keep exactly\n 🧭 " } });
  const retained = structuredClone(connected.drafts.list());

  fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Ship it") })).getByRole("button", { name: copy.close }));
  app.handlers["reaction.run"] = ({ id }) => {
    if (id === "r1") throw new Error("first reaction refused");

    return second;
  };

  fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
  fireEvent.click(screen.getByRole("button", { name: copy.reactionRun }));
  await screen.findByRole("alert", { name: "first reaction refused" });

  if (transition === "dismiss") fireEvent.click(screen.getByRole("button", { name: copy.clear }));
  else {
    await waitFor(() => expect(screen.getByRole("button", { name: copy.reactionRun })).toHaveProperty("disabled", false));
    fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Ship it") })).getByRole("button", { name: copy.close }));
    fireEvent.click(await screen.findByRole("button", { name: /Other reaction/ }));
    fireEvent.click(screen.getByRole("button", { name: copy.reactionRun }));
    await waitFor(() => expect(screen.getByRole("button", { name: copy.reactionRun })).toHaveProperty("disabled", false));
    fireEvent.click(within(screen.queryByRole("form", { name: copy.reactionCreate }) ?? screen.getByRole("region", { name: copy.reactionDetail("Other reaction") })).getByRole("button", { name: copy.close }));
    fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
  }

  expect(screen.queryByRole("alert", { name: "first reaction refused" }) !== null).toBe(transition !== "dismiss");
  expect(screen.getByRole("alert", { name: "No required-check results are available. Refresh to check again." })).toBeTruthy();
  expect(connected.drafts.list()).toEqual(retained);
});
