import { App } from "../App";
import { createFakeApp } from "../testing/fakeApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { openProjectPage } from "../testing/menuProbe";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import type { Message } from "@contracts/message/Message";
import type { Reaction } from "@contracts/reaction/Reaction";
import { agent, workstream } from "../testing/nodes";
import { mountAskBar } from "../ask/askFixture";
import { copy } from "./copy";

afterEach(cleanup);

const saved = (patch: Partial<Reaction> = {}): Reaction => ({
  project: "p", reason: null, id: "r1", name: "Ship it", actor: { kind: "user", id: "u", parent: null }, home: null, target: "a",
  instruction: "go", condition: { kind: "agents", ids: ["a"], any: false }, max_firings: 1, remaining: 1, rearm: false,
  expires_at: "2026-10-21T09:00:00Z", created_at: "2026-10-20T09:00:00Z", state: "active",
  observation: { health: "observing", health_code: "observing", cause_code: "unknown", gap_code: "unknown", recovery_code: "unknown", cursor: null, gap: null, recovery: null, evidence: null }, firings: [], ...patch,
});

const mount = async (list: () => Reaction[], homes: ReturnType<typeof workstream>[] = []) => {
  const mounted = await mountAskBar([], null, [...homes, agent("a", "idle", "ready")]);

  mounted.connected.showView("reactions");
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

it("nr9_inspect_stop_run_in_overview", async () => {
  let current = saved({ actor: { kind: "agent", id: "a", parent: null }, reason: "Wait for the review before shipping" });
  const { app, connected } = await mount(() => [current]);
  const row = await screen.findByRole("button", { name: /Ship it/ });

  expect(within(row).getByText(current.reason!)).toBeTruthy();
  row.focus();
  fireEvent.click(row);
  const detail = await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });

  expect(within(detail).getByText(current.reason!)).toBeTruthy();
  expect(within(detail).getByText(current.instruction)).toBeTruthy();
  expect(within(detail).getByText(copy.reactionAuthority).nextElementSibling?.textContent).toBe(current.actor.id);

  connected.showView("made");
  await waitFor(() => expect(screen.queryByRole("region", { name: copy.reactionDetail("Ship it") })).toBeNull());
  connected.showView("reactions");
  await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });
  expect(app.calls.map((call) => call.method)).not.toContain("reaction.run");
  app.handlers["reaction.stop"] = () => (current = { ...current, state: "stopped" });
  app.handlers["reaction.run"] = () => current;
  fireEvent.click(within(detail).getByRole("button", { name: copy.reactionRun }));
  await waitFor(() => expect(app.calls.filter((call) => call.method === "reaction.run")).toHaveLength(1));
  await waitFor(() => expect(within(detail).getByRole("button", { name: copy.reactionStop })).toHaveProperty("disabled", false));
  fireEvent.click(within(detail).getByRole("button", { name: copy.reactionStop }));
  await waitFor(() => expect(within(detail).getByRole("button", { name: copy.reactionRun })).toHaveProperty("disabled", true));
  expect(app.calls.filter(call => call.method === "reaction.run" || call.method === "reaction.stop").map(call => call.params)).toEqual([{ id: "r1", operation: expect.any(String) }, { id: "r1" }]);
  fireEvent.click(within(detail).getByRole("button", { name: /^Close/ }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /Ship it/ })));
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

it("nr9_saved_reactions_remain_inspectable_after_the_last_agent_is_removed", async () => {
  const { app, connected } = await mountAskBar([], null, []);
  connected.showView("reactions");
  app.handlers["reaction.list"] = () => [saved()];
  app.handlers["reaction.get"] = () => saved();
  window.dispatchEvent(new Event("focus"));
  fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
  const detail = await screen.findByRole("region", { name: copy.reactionDetail("Ship it") });
  expect(within(detail).getByText(copy.reactionGone())).toBeTruthy();
  expect(app.calls.filter(call => call.method === "reaction.run" || call.method === "agent.spawn")).toHaveLength(0);
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

const observeFailure = async (observation: Reaction["observation"]) => {
  const record = saved({ observation });
  const { app } = await mount(() => [record]);
  fireEvent.click(await screen.findByRole("button", { name: /Ship it/ }));
  const text = (await screen.findByRole("alert")).textContent;

  const controls = [copy.refresh, copy.reactionStop, copy.reactionRun].map(name => ({
    name, disabled: within(document.querySelector(".reaction-detail")!).getByRole("button", { name }).hasAttribute("disabled"),
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

it("u4276c_list_opens_exact_reaction", async () => {
  const records = [saved({ home: "alpha", actor: { kind: "agent", id: "maker-a", parent: null }, reason: "First prerequisite" }), saved({ id: "r2", home: "beta", instruction: "second", actor: { kind: "agent", id: "maker-b", parent: null }, reason: "Second prerequisite" })];
  const { app } = await mount(() => records, [workstream("alpha"), workstream("beta"), agent("maker-a", "idle", "ready", { name: "Same maker", parent: "alpha" }), agent("maker-b", "idle", "ready", { name: "Same maker", parent: "beta" })]);
  fireEvent.click(await screen.findByRole("button", { name: /Ship it.*beta/ }));
  await screen.findByText("second");
  expect(screen.getByText(records[1]!.reason!)).toBeTruthy();
  expect(screen.getByText(copy.reactionActor("agent", copy.draftIdentity("Same maker", "beta")))).toBeTruthy();
  expect(app.calls.filter(call => call.method === "reaction.get").map(call => call.params)).toEqual([{ id: "r2" }]);
  fireEvent.click(screen.getByRole("button", { name: "Close Ship it" }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /Ship it.*beta/ })));
});

const openings = [
  { opening: "Project menu → Named reactions", detail: false },
  { opening: "Named reactions → detail → list", detail: true },
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
  await screen.findByRole("button", { name: "Needs you" });
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

    if (owner !== "message") fireEvent.click(within(document.querySelector(".reaction-detail")!).getByRole("button", { name: action }));
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

      await waitFor(() => expect(within(document.querySelector(".reaction-detail")!).getByRole("button", { name: action })).toHaveProperty("disabled", false));
      fireEvent.click(within(document.querySelector(".reaction-detail")!).getByRole("button", { name: action }));
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

it("nr9_list_stop_keeps_selected_identity_after_refusal", async () => {
  const method = "reaction.stop";
  const records = [saved(), saved({ id: "r2", home: "beta", actor: { kind: "agent", id: "a", parent: null }, reason: "Wait for review" })];
  const { app } = await mount(() => records, [workstream("beta")]);
  const opener = await screen.findByRole("button", { name: /Ship it.*beta/ });
  opener.focus();
  const row = opener.closest("li")!;
  const action = () => within(row).getByRole("button", { name: copy.reactionStop });
  app.handlers[method] = () => { throw new Error("Access refused. Restore access and retry."); };

  fireEvent.click(action());
  await within(row).findByRole("alert", { name: "Access refused. Restore access and retry." });
  app.handlers[method] = () => records[1]!;
  await waitFor(() => expect(action()).toHaveProperty("disabled", false));
  fireEvent.click(action());
  await waitFor(() => expect(within(row).queryByRole("alert")).toBeNull());
  expect(app.calls.filter(call => call.method === method).map(call => call.params)).toEqual([
    expect.objectContaining({ id: "r2" }), expect.objectContaining({ id: "r2" }),
  ]);
  expect(app.calls.filter(call => call.method === "reaction.create" || call.method === "agent.spawn")).toHaveLength(0);
});
