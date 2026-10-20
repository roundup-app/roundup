import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { Reaction } from "@contracts/reaction/Reaction";
import { RpcError } from "../app/seam";
import { agent, door } from "../testing/nodes";
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
  fireEvent.click(within(detail).getByRole("button", { name: copy.reactionBack }));
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
  fireEvent.click(screen.getByRole("button", { name: copy.reactionSave }));
  await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });

  const sent = app.calls.filter((call) => call.method === "reaction.create").map((call) => call.params);

  expect(sent).toMatchObject([{ operation: "op-1", instruction: "exact\n words " }, { operation: "op-1", instruction: "exact\n words " }]);
  expect(connected.drafts.list().filter((draft) => draft.destination.surface === "reactions")).toEqual([]);
});

it("nr9_overlapping_names_keep_the_selected_identity_through_creation", async () => {
  const { app, connected } = await mountAskBar([], null, [
    agent("a", "idle", "ready", { name: "Builder" }),
    agent("b", "idle", "ready", { name: "Builder" }),
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
  fireEvent.click(await screen.findByRole("option", { name: "Builder (b)" }));
  const preview = screen.getByRole("region", { name: copy.reactionPreview });

  await within(preview).findByText("Builder (b)");
  fireEvent.click(screen.getByRole("checkbox", { name: "Builder (a)" }));
  await within(preview).findByText(/Builder \(a\)/);
  const save = screen.getByRole("button", { name: copy.reactionSave });

  await waitFor(() => expect(save).toHaveProperty("disabled", false));
  fireEvent.click(save);
  const detail = await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });

  expect(app.calls.find((call) => call.method === "reaction.create")?.params).toMatchObject({ target: "b", condition: { ids: ["a"] } });
  expect(within(detail).getByText("Builder (b)")).toBeTruthy();
  expect(within(detail).getByText(/Builder \(a\)/)).toBeTruthy();
});

it("nr9_firing_opens_only_its_recorded_message_and_returns_focus", async () => {
  const { app } = await mount(() => [saved({ firings: [{ id: "f1", ordinal: 1, message: 42, matched: true, evidence: "finished", definition: "{}", outcome: "held" }] })]);
  app.handlers["message.get"] = () => ({ id: 42, from: { kind: "user", id: "u", parent: null }, to: "a", body: "exact accepted instruction", kind: "note", replyTo: null, status: "dropped", reason: "receiver gone", passedFrom: null, at: 0 });
  fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
  const link = await screen.findByRole("button", { name: /Message #42/ });
  fireEvent.click(link);
  await screen.findByText("exact accepted instruction");
  expect(app.calls.filter(call => call.method === "message.get").map(call => call.params)).toEqual([{ id: 42 }]);
  expect(screen.getByText(/receiver gone/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: copy.reactionBackToFiring }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /Message #42/ })));
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
  fireEvent.click(screen.getByRole("button", { name: copy.reactionBack }));
  fireEvent.click(screen.getByRole("button", { name: copy.reactionCreate }));
  expect(screen.getByLabelText(copy.reactionInstruction)).toHaveProperty("value", " newer\n exact 🧭 ");
});


it("nr9_reload_and_project_switch_keep_the_original_recipient_without_sending", async () => {
  const first = await mount(() => []);
  const path = first.connected.project.path;
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  fireEvent.input(screen.getByLabelText(copy.reactionInstruction), { target: { value: " original e\u0301\n 🧭 " } });
  fireEvent.click(screen.getByRole("combobox", { name: copy.reactionTarget }));
  fireEvent.click(await screen.findByRole("option", { name: "a (a)" }));
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
  expect(within(detail).getByText(copy.reactionGone("a"))).toBeTruthy();
  expect(app.calls.filter(call => call.method === "reaction.run" || call.method === "agent.spawn")).toHaveLength(0);
});

it("nr9_can_select_the_existing_supervisor_without_starting_it", async () => {
  const { app } = await mountAskBar([], null, [door("lead", "idle", "ready", { name: "Supervisor" })]);
  fireEvent.click(await screen.findByRole("button", { name: copy.reactionCreate }));
  fireEvent.click(screen.getByRole("combobox", { name: copy.reactionTarget }));
  fireEvent.click(await screen.findByRole("option", { name: "Supervisor (lead)" }));
  const preview = screen.getByRole("region", { name: copy.reactionPreview });
  await within(preview).findByText("Supervisor (lead)");
  expect(within(preview).getByText(copy.reactionNoHome)).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "Supervisor (lead)" })).toBeTruthy();
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

  if (action === "back") fireEvent.click(screen.getByRole("button", { name: copy.reactionBack }));
  else fireEvent.input(screen.getByLabelText(copy.reactionInstruction), { target: { value: "new words" } });
  list = [saved()];
  acknowledge(list[0]!);
  await waitFor(() => expect(connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));

  if (action === "edit") fireEvent.click(screen.getByRole("button", { name: copy.reactionBack }));
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
  } else fireEvent.click(screen.getByRole("button", { name: copy.reactionBack }));
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
  fireEvent.click(await screen.findByRole("option", { name: "a0 (a0)" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "a0 (a0)" }));
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
