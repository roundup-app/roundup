import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { event, workstream } from "../testing/nodes";
import { RpcError } from "../app/seam";
import type { Deliverable } from "@contracts/deliverable/Deliverable";
import type { Ask } from "@contracts/ask/Ask";
import { ask, input, mountAskBar, press } from "./askFixture";

afterEach(cleanup);

const type = (text: string) => fireEvent.input(input()!, { target: { value: text } });

const sent = (app: { calls: { method: string; params: unknown }[] }) => app.calls.filter((call) => call.method === "ask.send").map((call) => call.params);

describe("u504 the Ask bar", () => {
  it("u504_the_home_screen_is_the_ask_bar", async () => {
    const { connected } = await mountAskBar();

    expect(input()).not.toBeNull();

    connected.showView(null);

    connected.rail.select("lead");
    await waitFor(() => expect(input()).toBeNull());

    connected.showView(null);

    connected.rail.select(null);
    await waitFor(() => expect(input()).not.toBeNull());
  });

  it("u504_the_shortcut_opens_it_over_a_door_and_escape_returns", async () => {
    await mountAskBar([], "lead");
    const outside = document.querySelector<HTMLElement>(".outside")!;

    outside.focus();
    expect(input()).toBeNull();

    expect(press("/", { metaKey: true }, outside).defaultPrevented).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(input()));
    expect(document.querySelector(".ask-bar")!.getAttribute("data-mode")).toBe("over");

    press("Escape", {}, input()!);
    await waitFor(() => expect(input()).toBeNull());
    expect(document.activeElement).toBe(outside);
  });



  it("u504_at_lists_workstreams_and_writes_the_name", async () => {
    const { app } = await mountAskBar();

    input()!.focus();
    type("@");
    const list = await screen.findByRole("listbox");
    const options = within(list).getAllByRole("option");
    const active = () => document.getElementById(input()!.getAttribute("aria-activedescendant") ?? "");

    await waitFor(() => expect(active()).toBe(options[0]));
    expect(input()!.getAttribute("aria-controls")).toBe(list.id);
    press("ArrowUp", {}, input()!);
    await waitFor(() => expect(active()).toBe(options[2]));
    press("ArrowDown", {}, input()!);
    await waitFor(() => expect(active()).toBe(options[0]));
    press("ArrowDown", {}, input()!);
    await waitFor(() => expect(active()).toBe(options[1]));
    expect(document.activeElement).toBe(input());

    type("@OP");
    await waitFor(() => expect([...document.querySelectorAll(".app-mentions [role=option]")].map((item) => item.textContent)).toEqual(["ops"]));

    press("Enter", {}, input()!);
    await waitFor(() => expect(input()!.value).toBe("@ops "));
    expect([input()!.selectionStart, input()!.selectionEnd]).toEqual([5, 5]);
    expect(sent(app)).toEqual([]);
    expect(document.querySelector(".app-mentions")).toBeNull();
  });

  it("u504_tab_keeps_the_keyboard_match_after_pointer_movement", async () => {
    const { app } = await mountAskBar();
    input()!.focus();
    type("@");
    const list = await screen.findByRole("listbox");
    const options = within(list).getAllByRole("option");
    await waitFor(() => expect(input()!.getAttribute("aria-activedescendant")).toBe(options[0]!.id));
    fireEvent.pointerMove(options[2]!, { pointerType: "mouse" });
    await waitFor(() => expect(input()!.getAttribute("aria-activedescendant")).toBe(options[0]!.id));
    expect(press("Tab", {}, input()!).defaultPrevented).toBe(true);
    await waitFor(() => expect(input()!.value).toBe("@lead "));
    expect([input()!.selectionStart, input()!.selectionEnd]).toEqual([6, 6]);
    expect(document.activeElement).toBe(input());
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(sent(app)).toEqual([]);
  });

  it.each(["home", "over"])("u504_escape_closes_mentions_and_keeps_the_draft_in_%s", async (mode) => {
    await mountAskBar([], mode === "over" ? "lead" : null);

    if (mode === "over") press("/", { metaKey: true }, document.querySelector<HTMLElement>(".outside")!);

    input()!.focus();
    type("@");
    press("Escape", {}, input()!);
    await waitFor(() => expect(document.querySelector(".app-mentions")).toBeNull());
    expect(input()!.value).toBe("@");
    expect(document.activeElement).toBe(input());

    if (mode === "over") {
      press("Escape", {}, input()!);
      await waitFor(() => expect(input()).toBeNull());
    }
  });

  it("u504_click_picks_a_workstream", async () => {
    await mountAskBar();
    input()!.focus();
    type("@");

    const option = await waitFor(() => {
      const item = document.querySelector<HTMLElement>(".app-mentions [role=option]");

      expect(item).not.toBeNull();

      return item!;
    });

    fireEvent.pointerDown(option, { pointerType: "mouse", button: 0 });
    expect(document.activeElement).toBe(input());
    fireEvent.click(option);
    await waitFor(() => expect(input()!.value).toBe("@lead "));
    expect(document.activeElement).toBe(input());
    expect(document.querySelector(".app-mentions")).toBeNull();
  });

  it("u504_equal_names_accept_the_chosen_workstream_identity", async () => {
    const { app } = await mountAskBar([], null, [
      workstream("one", { name: "First parent" }), workstream("two", { name: "Second parent" }),
      workstream("first", { name: "Same", parent: "one" }), workstream("second", { name: "Same", parent: "two" }),
    ]);

    input()!.focus();
    type("@same");

    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options).toHaveLength(2);
    press("ArrowDown", {}, input()!);
    await waitFor(() => expect(input()!.getAttribute("aria-activedescendant")).toBe(options[1]!.id));
    press("Enter", {}, input()!);
    await waitFor(() => expect(input()!.value).toBe("@Same "));
    type("@Same do this");
    press("Enter", {}, input()!);
    await waitFor(() => expect(sent(app)).toHaveLength(1));
    expect(sent(app)[0]).toMatchObject({ text: "@Same do this", workstream: "second" });
  });

  it("u504_no_matching_workstream_closes_mentions", async () => {
    await mountAskBar();
    type("@");
    type("@missing");
    expect(document.querySelector(".app-mentions")).toBeNull();
    expect(input()!.value).toBe("@missing");
  });

  it("u504_shift_enter_adds_a_line", async () => {
    const { app } = await mountAskBar();

    type("one");
    const line = press("Enter", { shiftKey: true }, input()!);

    expect(line.defaultPrevented).toBe(false);
    expect(sent(app)).toEqual([]);
    expect(input()!.value).toBe("one");
  });
});

it.each(["refused", "unknown", "unknown-rpc", "internal", "acknowledged"] as const)("u2773b_holder_returns_captured_identity_for_late_%s", async (kind) => {
  const { app, connected } = await mountAskBar();
  let resolveA!: (ask: Ask) => void;
  let rejectA!: (reason: Error) => void;
  const refusal = new RpcError(-32003, "original unavailable");
  app.handlers["ask.send"] = request => request.submission === "a"
    ? new Promise<Ask>((resolve, reject) => { resolveA = resolve; rejectA = reject; })
    : { ...ask("accepted-b", 2, [], request.text), submission: "b" };
  const captured = { text: "  @Same exact 🌿\n ", submission: "a", workstream: "original" };
  const a = connected.asks.send(captured);
  captured.text = "newer editor value";
  const b = await connected.asks.send({ text: "newer B", submission: "b" });
  expect(b.kind).toBe("acknowledged");

  if (kind === "acknowledged") resolveA({ ...ask("accepted-a", 1, [], "  @Same exact 🌿\n "), submission: "a" });
  else rejectA(kind === "refused" ? refusal : kind === "unknown-rpc" ? new RpcError(-32004, "connection lost after write") : kind === "internal" ? new RpcError(-32603, "timeout") : new Error("connection lost"));
  const result = await a;
  expect(result.kind).toBe(kind === "unknown-rpc" || kind === "internal" ? "unknown" : kind);
  expect(result.submission).toBe("a");

  if (result.kind === "refused") expect(result.error).toBe(refusal);
  expect(sent(app)).toEqual([
    { text: "  @Same exact 🌿\n ", submission: "a", workstream: "original" },
    { text: "newer B", submission: "b" },
  ]);
  expect(connected.asks.entries().find(entry => entry.key === "accepted-b")?.text).toBe("newer B");
});

it("u2773b_reconciliation_reads_acceptance_without_sending", async () => {
  const { app, connected } = await mountAskBar();
  app.handlers["ask.send"] = () => { throw new Error("response lost"); };

  expect((await connected.asks.send({ text: "same", submission: "a" })).kind).toBe("unknown");
  app.handlers["ask.list"] = () => [{ ...ask("accepted", 1, [], "same"), submission: "a" }];
  expect(await connected.asks.reconcile("a")).toMatchObject({ kind: "acknowledged", submission: "a", ask: { id: "accepted" } });
  expect((await connected.asks.reconcile("b")).kind).toBe("unknown");
  app.handlers["ask.list"] = () => { throw new RpcError(-32603, "disconnected"); };

  expect((await connected.asks.reconcile("a")).kind).toBe("unknown");
  expect(sent(app)).toEqual([{ text: "same", submission: "a" }]);
});


it("u2773a_ask_restores_exact_work", async () => {
  const first = await mountAskBar();
  const exact = "  e\u0301 🌿\nsecond line  ";
  type(exact);
  input()!.setSelectionRange(2, 6, "backward");
  fireEvent.select(input()!);
  first.app.emit(event({ name: "ask.changed", data: { ask: ask("incoming", 1, [], "incoming work") } }));
  expect(input()!.value).toBe(exact);
  first.connected.showView(null);
  first.connected.rail.select("ann");
  expect(input()).toBeNull();
  press("/", { metaKey: true }, document.querySelector(".outside")!);
  await waitFor(() => expect(input()!.value).toBe(exact));
  expect([input()!.selectionStart, input()!.selectionEnd, input()!.selectionDirection]).toEqual([2, 6, "backward"]);
  const path = first.connected.project.path;
  first.unmount();
  const other = await mountAskBar();
  expect(input()!.value).toBe("");
  type("other Project");
  other.unmount();
  const reopened = await mountAskBar([], null, undefined, false, path);
  expect(input()!.value).toBe(exact);
  expect(document.activeElement).not.toBe(input());
  expect([input()!.selectionStart, input()!.selectionEnd, input()!.selectionDirection]).toEqual([2, 6, "backward"]);
  expect(sent(first.app)).toEqual([]);
  expect(sent(other.app)).toEqual([]);
  expect(sent(reopened.app)).toEqual([]);
});

it.each(["refused", "unknown", "acknowledged"] as const)("u2773b_ask_settlement_preserves_other_revisions_%s", async (outcome) => {
  const first = await mountAskBar();
  let accept!: (ask: Ask) => void;
  let reject!: (error: Error) => void;
  first.app.handlers["ask.send"] = () => new Promise<Ask>((resolve, fail) => { accept = resolve; reject = fail; });
  type("  A 🌿\n ");
  press("Enter", {}, input()!);
  type("  B e\u0301\n ");

  await waitFor(() => expect(sent(first.app)).toHaveLength(1));

  if (outcome === "acknowledged") accept(ask("accepted", 1, []));
  else reject(outcome === "refused" ? new RpcError(-32003, "refused") : new Error("lost reply"));
  await waitFor(() => expect(first.connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));
  expect(input()!.value).toBe("  B e\u0301\n ");
  expect(first.connected.drafts.list().map(draft => [draft.value.text, draft.status])).toEqual(outcome === "acknowledged"
    ? [["  B e\u0301\n ", "draft"]] : [["  A 🌿\n ", outcome === "refused" ? "failed" : "unknown"], ["  B e\u0301\n ", "draft"]]);
  const path = first.connected.project.path;
  const retained = first.connected.drafts.list();
  await waitFor(() => expect(JSON.parse(localStorage.getItem(`roundup:drafts:${path}`)!).drafts).toEqual(retained));
  first.unmount();
  const reopened = await mountAskBar([], null, undefined, false, path);
  expect(input()!.value).toBe("  B e\u0301\n ");
  expect(sent(reopened.app)).toEqual([]);
  const older = reopened.connected.drafts.list().find(draft => draft.status !== "draft");

  if (older) {
    fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => expect(JSON.parse(localStorage.getItem(`roundup:drafts:${path}`)!).drafts).toHaveLength(1));
  }

  reopened.unmount();
  const again = await mountAskBar([], null, undefined, false, path);
  expect(again.connected.drafts.list().map(draft => draft.value.text)).toEqual(["  B e\u0301\n "]);
});

it("u2773b_ask_checks_unknown_acceptance_without_resending", async () => {
  const { app, connected } = await mountAskBar();
  app.handlers["ask.send"] = () => { throw new Error("lost reply"); };

  type(" exact A 🌿\n ");
  press("Enter", {}, input()!);
  type("new B");
  const check = await screen.findByRole("button", { name: "Check send status: exact A 🌿" });
  const submission = connected.drafts.list().find(draft => draft.status === "unknown")!.revision;
  app.handlers["ask.list"] = () => [{ ...ask("accepted", 1, [], " exact A 🌿\n "), submission }];
  fireEvent.click(check);
  await waitFor(() => expect(connected.drafts.list().map(draft => draft.value.text)).toEqual(["new B"]));
  expect(input()!.value).toBe("new B");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(sent(app)).toEqual([{ text: " exact A 🌿\n ", submission }]);
});

it("u2773a_ask_keeps_captured_workstream_after_equal_named_replacement", async () => {
  const { connected, app } = await mountAskBar();
  type("@ops exact 🌿");
  const tree = connected.rail.nodes.map(node => node.id === "ops" ? { ...node, name: "Renamed" } : { ...node });
  app.handlers["rail.tree"] = () => [...tree, workstream("replacement", { name: "ops" })];
  app.emit(event({ name: "rail.changed" }));
  await waitFor(() => expect(connected.rail.nodes.find(node => node.id === "replacement")?.name).toBe("ops"));
  type("@ops exact 🌿 more");
  press("Enter", {}, input()!);
  await waitFor(() => expect(sent(app)).toHaveLength(1));
  expect(sent(app)[0]).toMatchObject({ text: "@ops exact 🌿 more", workstream: "ops" });
});

it("u2773b_ask_late_failure_settles_only_the_original_project", async () => {
  const first = await mountAskBar();
  let reject!: (reason: Error) => void;
  first.app.handlers["ask.send"] = () => new Promise<Ask>((_resolve, fail) => { reject = fail; });
  type("original A 🌿");
  press("Enter", {}, input()!);
  first.unmount();
  const other = await mountAskBar();
  type("other Project B");
  reject(new RpcError(-32003, "original refused"));
  await waitFor(() => expect(first.connected.drafts.list()[0]?.status).toBe("failed"));
  expect(input()!.value).toBe("other Project B");
  expect(other.connected.drafts.list().map(draft => draft.value.text)).toEqual(["other Project B"]);
  expect(first.connected.drafts.list()[0]?.value.text).toBe("original A 🌿");
  expect(sent(other.app)).toEqual([]);
});

it("u2773b_ask_repeat_enter_cannot_send_an_older_failed_revision", async () => {
  const { app, connected } = await mountAskBar();
  app.handlers["ask.send"] = () => { throw new RpcError(-32003, "refused A"); };

  type("failed A");
  press("Enter", {}, input()!);
  await waitFor(() => expect(connected.drafts.list()[0]?.status).toBe("failed"));
  let accept!: (value: Ask) => void;
  app.handlers["ask.send"] = () => new Promise<Ask>(resolve => { accept = resolve; });
  type("pending B");
  press("Enter", {}, input()!);
  press("Enter", { repeat: true }, input()!);
  await waitFor(() => expect(sent(app)).toHaveLength(2));
  expect(sent(app)).toEqual([{ text: "failed A", submission: expect.any(String) }, { text: "pending B", submission: expect.any(String) }]);
  accept(ask("accepted", 1, []));
});

it("u2773a_ask_captures_the_longest_name_case_insensitively", async () => {
  const { app } = await mountAskBar([], null, [workstream("short", { name: "Alpha" }), workstream("long", { name: "Alpha Beta" })]);
  type("@Alpha ");
  type("@aLPHa bETA exact 🌿");
  press("Enter", {}, input()!);
  await waitFor(() => expect(sent(app)).toHaveLength(1));
  expect(sent(app)).toEqual([{ text: "@aLPHa bETA exact 🌿", submission: expect.any(String), workstream: "long" }]);
});

it("u2773b_unknown_asks_have_individual_status_checks", async () => {
  const { app, connected } = await mountAskBar();
  app.handlers["ask.send"] = () => { throw new RpcError(-32603, "connection lost"); };

  for (const text of ["Run the migration on staging", "Check the production logs"]) {
    type(text);
    press("Enter", {}, input()!);
    await screen.findByRole("button", { name: "Check send status: " + text });
  }

  const unknown = connected.drafts.list().filter(draft => draft.status === "unknown");
  app.handlers["ask.list"] = () => [{ ...ask("accepted", 1, [], String(unknown[0]!.value.text)), submission: unknown[0]!.revision }];
  fireEvent.click(screen.getByRole("button", { name: "Check send status: Run the migration on staging" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Check send status: Run the migration on staging" })).toBeNull());
  expect(screen.getByRole("button", { name: "Check send status: Check the production logs" })).toBeTruthy();
  expect(connected.drafts.list().filter(draft => draft.status === "unknown").map(draft => draft.value.text)).toEqual(["Check the production logs"]);
  expect(sent(app)).toHaveLength(2);
});


it("u2773e_recovery_actions_keep_surface_draft", async () => {
  const mounted = await mountAskBar();
  const exact = "  memory e\u0301 🌿\nlast line  ";
  const clipboard = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(mounted.app, "clipboardWrite").mockImplementation(clipboard);
  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });

  try {
    type(exact);
    expect(input()!.value).toBe(exact);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work" }));
    await screen.findByRole("button", { name: "Open" });
    expect(clipboard).not.toHaveBeenCalled();
    expect(input()!.value).toBe(exact);
    writes.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(sent(mounted.app)).toEqual([]);
    const path = mounted.connected.project.path;
    mounted.unmount();
    const reopened = await mountAskBar([], null, undefined, false, path);
    expect(input()!.value).toBe(exact);
    // Leaving the Ask bar with its text unsent lists it (U3289a).
    reopened.connected.showView(null);
    reopened.connected.rail.select("ann");
    expect(reopened.connected.drafts.recoverable().map(draft => draft.value.text)).toEqual([exact]);
    reopened.connected.showView(null);
    reopened.connected.rail.select(null);
    expect(input()!.value).toBe(exact);
    expect(sent(reopened.app)).toEqual([]);
    reopened.unmount();
    await mountAskBar([], null, undefined, false, path);
    expect(input()!.value).toBe(exact);
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it("u2773b_ask_out_of_order_replies_keep_newest_work", async () => {
  const { app, connected } = await mountAskBar();
  let refuseA!: (error: Error) => void;
  let acceptB!: (value: Ask) => void;
  let count = 0;
  app.handlers["ask.send"] = () => ++count === 1
    ? new Promise<Ask>((_resolve, reject) => { refuseA = reject; })
    : new Promise<Ask>(resolve => { acceptB = resolve; });
  type(" A 🌿\n ");
  press("Enter", {}, input()!);
  type(" B e\u0301\n ");
  press("Enter", {}, input()!);
  type(" C newest\n ");
  await waitFor(() => expect(sent(app)).toHaveLength(2));
  acceptB(ask("accepted-b", 1, []));
  await waitFor(() => expect(connected.drafts.list().map(draft => draft.value.text)).toEqual([" A 🌿\n ", " C newest\n "]));
  refuseA(new RpcError(-32003, "older refused"));
  await screen.findByRole("alert");
  expect(input()!.value).toBe(" C newest\n ");
  expect(connected.drafts.list().map(draft => [draft.value.text, draft.status])).toEqual([[" A 🌿\n ", "failed"], [" C newest\n ", "draft"]]);
  expect(sent(app)).toHaveLength(2);
});


it.each(["failed", "unknown"] as const)("u3021c_open_restores_exact_revision_without_rpc_ask_%s", async outcome => {
  const mounted = await mountAskBar();
  const { app, connected, setRecovery } = mounted;
  const destination = { surface: "ask", object: "ask-bar", recipient: null };
  const exact = "@ops  e\u0301 🌿\n次の行  ";
  const selection = { start: 2, end: 8, direction: "backward" as const };
  const a = connected.drafts.edit(destination, { text: exact, workstream: "ops", name: "ops" }, selection, "ordinary").draft;
  await connected.drafts.submit(a.revision); await connected.drafts.settle(a.revision, outcome);
  const b = connected.drafts.edit(destination, { text: "  newer B 🌱\n ", workstream: null, name: null }, { start: 3, end: 7, direction: "forward" }, "ordinary").draft;
  connected.showView(null);
  connected.rail.select("ann");
  const before = connected.drafts.list();
  const calls = [...app.calls];

  setRecovery({ project: connected.project.path, revision: a.revision });
  await waitFor(() => expect(document.activeElement).toBe(input()));
  expect([input()!.value, input()!.selectionStart, input()!.selectionEnd, input()!.selectionDirection]).toEqual([exact, 2, 8, "backward"]);
  input()!.focus(); fireEvent.blur(input()!);
  press("Escape", {}, input()!);
  expect(connected.drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
  press("/", { metaKey: true }, document.querySelector(".outside")!);
  await waitFor(() => expect(document.activeElement).toBe(input()));
  expect([input()!.value, input()!.selectionStart, input()!.selectionEnd, input()!.selectionDirection]).toEqual(["  newer B 🌱\n ", 3, 7, "forward"]);
  expect(connected.drafts.list().find(draft => draft.revision === b.revision)).toEqual(b);
  expect(app.calls).toEqual(calls);
});


it.each(["failed", "unknown"] as const)("u3021c_ask_editing_selected_work_preserves_current_%s", async outcome => {
  const mounted = await mountAskBar();
  const { app, connected, setRecovery } = mounted;

  type("@ops A e\u0301 🌿\nexact  ");
  input()!.setSelectionRange(2, 8, "backward"); fireEvent.select(input()!);
  const a = connected.drafts.list()[0]!;
  await connected.drafts.submit(a.revision); await connected.drafts.settle(a.revision, outcome);
  expect(a.value).toMatchObject({ workstream: "ops", name: "ops" });
  type("B current\n  ");
  input()!.setSelectionRange(1, 4, "forward"); fireEvent.select(input()!);
  const b = connected.drafts.list().at(-1)!;
  // Equal names do not replace the captured Workstream identity.
  app.handlers["rail.tree"] = () => [workstream("ops", { name: "Renamed" }), workstream("replacement", { name: "ops" })];
  app.emit(event({ name: "rail.changed" }));
  await connected.rail.settled();
  const calls = [...app.calls];
  setRecovery({ project: connected.project.path, revision: a.revision });
  await waitFor(() => expect(document.activeElement).toBe(input()));
  expect(input()!.value).toBe("@ops A e\u0301 🌿\nexact  ");
  type("@ops A e\u0301 🌿\nedited  ");
  input()!.setSelectionRange(3, 9, "backward"); fireEvent.select(input()!);
  const edited = connected.drafts.list().at(-1)!;
  expect(connected.drafts.list().find(draft => draft.revision === b.revision)).toEqual(b);
  expect(app.calls).toEqual(calls);
  press("Escape", {}, input()!);
  expect(input()!.value).toBe("B current\n  ");
  const path = connected.project.path;
  await waitFor(() => expect(JSON.parse(localStorage.getItem(`roundup:drafts:${path}`)!).drafts.some((draft: { revision: string; selection: unknown }) => draft.revision === edited.revision && JSON.stringify(draft.selection) === JSON.stringify(edited.selection))).toBe(true));
  mounted.unmount();
  const reopened = await mountAskBar([], null, undefined, false, path);
  expect([input()!.value, input()!.selectionStart, input()!.selectionEnd, input()!.selectionDirection]).toEqual(["B current\n  ", 1, 4, "forward"]);
  expect(reopened.connected.drafts.list()).toContainEqual(edited);
  expect(edited.value).toMatchObject({ text: "@ops A e\u0301 🌿\nedited  ", workstream: "ops" });
  reopened.setRecovery({ project: path, revision: edited.revision });
  await waitFor(() => expect(document.activeElement).toBe(input()));
  expect([input()!.value, input()!.selectionStart, input()!.selectionEnd, input()!.selectionDirection]).toEqual(["@ops A e\u0301 🌿\nedited  ", 3, 9, "backward"]);
  let accept!: (value: Ask) => void;
  reopened.app.handlers["ask.send"] = () => new Promise<Ask>(resolve => { accept = resolve; });
  press("Enter", {}, input()!); press("Enter", { repeat: true }, input()!);
  await waitFor(() => expect(sent(reopened.app)).toHaveLength(1));
  expect(sent(reopened.app)).toEqual([{ text: "@ops A e\u0301 🌿\nedited  ", submission: edited.revision, workstream: "ops" }]);
  accept(ask("accepted", 1, []));
  await waitFor(() => expect(reopened.connected.drafts.list().some(draft => draft.revision === edited.revision)).toBe(false));
  expect(reopened.connected.drafts.list().find(draft => draft.revision === b.revision)).toEqual(b);
  expect(reopened.connected.drafts.list().find(draft => draft.revision === a.revision)).toEqual(a.status === "draft" ? { ...a, status: outcome } : a);
});


it.each(["project", "surface", "object", "recipient", "removed"] as const)("u3021c_ask_refuses_selected_%s_identity", async mismatch => {
  const { app, connected, setRecovery } = await mountAskBar([], "ann");
  const destination = { surface: mismatch === "surface" ? "orders" : "ask", object: mismatch === "object" ? "other" : "ask-bar", recipient: mismatch === "recipient" ? "other" : null };
  const a = connected.drafts.edit(destination, { text: "@gone exact e\u0301 🌿\n ", workstream: mismatch === "removed" ? "gone" : null, name: "gone" }, null, "ordinary").draft;
  await connected.drafts.submit(a.revision); await connected.drafts.settle(a.revision, "failed");
  const before = connected.drafts.list();
  const calls = [...app.calls];
  setRecovery({ project: mismatch === "project" ? "/other-project" : connected.project.path, revision: a.revision });
  // AskBar's prop effect and selection restoration run in Solid's effect/microtask turn.
  await Promise.resolve();
  expect(input()).toBeNull();
  expect(connected.drafts.list()).toEqual(before);
  expect(app.calls).toEqual(calls);
});

it("u3021c_ask_unknown_open_never_resubmits_before_explicit_reconciliation", async () => {
  const { app, connected, setRecovery } = await mountAskBar();
  app.handlers["ask.send"] = () => { throw new Error("reply lost"); };

  type("A exact 🌿\n "); press("Enter", {}, input()!);
  await screen.findByRole("button", { name: "Check send status: A exact 🌿" });
  const a = connected.drafts.list()[0]!;
  type("B current");
  const b = connected.drafts.list().at(-1)!;
  setRecovery({ project: connected.project.path, revision: a.revision });
  await waitFor(() => expect(document.activeElement).toBe(input()));
  const calls = [...app.calls];
  press("Enter", {}, input()!);
  expect(input()!.value).toBe("A exact 🌿\n ");
  expect(app.calls).toEqual(calls);
  app.handlers["ask.list"] = () => [{ ...ask("accepted", 1, [], "A exact 🌿\n "), submission: a.revision }];
  fireEvent.click(screen.getByRole("button", { name: "Check send status: A exact 🌿" }));
  await waitFor(() => expect(connected.drafts.list()).toEqual([b]));
  press("Escape", {}, input()!);
  expect(input()!.value).toBe("B current");
  expect(sent(app)).toHaveLength(1);
});

it("u3021c_copy_and_discard_keep_other_revisions_ask", async () => {
  const mounted = await mountAskBar();
  const { app, connected } = mounted;
  const exact = "@removed  e\u0301 🌿\n次の行  ";
  const destination = { surface: "ask", object: "ask-bar", recipient: null };
  const a = connected.drafts.edit(destination, { text: exact, workstream: "removed", name: "removed" }, null, "ordinary").draft;
  await connected.drafts.submit(a.revision); await connected.drafts.settle(a.revision, "failed");
  type("B current");
  const b = connected.drafts.list().at(-1)!;
  const clipboard = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(app, "clipboardWrite").mockImplementation(clipboard);

  try {
    connected.showView(null);
    connected.rail.select("ann");
    fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work" }));
    const copy = await screen.findByRole("button", { name: "Copy" });

    fireEvent.click(copy);
    expect(clipboard.mock.calls).toEqual([[exact]]);
    fireEvent.click(within(copy.closest("li")!).getByRole("button", { name: "Discard" }));
    expect(connected.drafts.list()).toEqual([b]);
    const path = connected.project.path;
    mounted.unmount();
    const other = await mountAskBar(); type("other Project");
    const otherPath = other.connected.project.path;
    other.unmount();
    const reopened = await mountAskBar([], null, undefined, false, path);
    expect(reopened.connected.drafts.list()).toEqual([b]);
    expect(sent(app)).toEqual([]);
    reopened.unmount();
    await mountAskBar([], null, undefined, false, otherPath);
    expect(input()!.value).toBe("other Project");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("u3021c_ask_ordinary_edits_preserve_recovered_work_after_older_settlement", async () => {
  const mounted = await mountAskBar();
  const { connected, setRecovery } = mounted;
  const destination = { surface: "ask", object: "ask-bar", recipient: null };
  const a = connected.drafts.edit(destination, { text: "A original", workstream: null, name: null }, null, "ordinary").draft;
  await connected.drafts.submit(a.revision); await connected.drafts.settle(a.revision, "unknown");
  type("B current");
  setRecovery({ project: connected.project.path, revision: a.revision });
  await waitFor(() => expect(document.activeElement).toBe(input()));
  type("A recovered edit");
  input()!.setSelectionRange(2, 5, "backward"); fireEvent.select(input()!);
  const edited = connected.drafts.list().at(-1)!;
  press("Escape", {}, input()!);
  type("B newer edit");
  await connected.drafts.settle(a.revision, "acknowledged");
  expect(input()!.value).toBe("B newer edit");
  expect(connected.drafts.list()).toContainEqual(edited);
  const path = connected.project.path;

  mounted.unmount();
  const reopened = await mountAskBar([], null, undefined, false, path);
  expect(input()!.value).toBe("B newer edit");
  reopened.setRecovery({ project: path, revision: edited.revision });
  await waitFor(() => expect(document.activeElement).toBe(input()));
  expect([input()!.value, input()!.selectionStart, input()!.selectionEnd, input()!.selectionDirection]).toEqual(["A recovered edit", 2, 5, "backward"]);
});

it.each(["failed", "unknown"] as const)("u3021c_ask_opening_current_work_keeps_its_edits_current_%s", async outcome => {
  const { connected, setRecovery } = await mountAskBar();

  type("current A");
  const a = connected.drafts.list()[0]!;
  await connected.drafts.submit(a.revision); await connected.drafts.settle(a.revision, outcome);
  setRecovery({ project: connected.project.path, revision: a.revision });
  await waitFor(() => expect(document.activeElement).toBe(input()));
  type("edited current A");
  press("Escape", {}, input()!);
  expect(input()!.value).toBe("edited current A");
});

const published = (revision: number): Deliverable => ({
  id: `publication-${revision}`, project: "project-original", maker: { kind: "agent", id: "gone", parent: null }, maker_name: "Review", home: null,
  title: "Same title", published_at: 1792713600000,
  target: { kind: "pad", name: "original-pad", incarnation: "original-incarnation", revision, sha256: `hash-${revision}`, length: 10 },
});

it("u3299d_copy_uses_selected_item_publication", async () => {
  const { app, connected } = await mountAskBar();
  connected.showView("made");
  const records = [published(7), published(9)];
  app.handlers["deliverable.list"] = () => records;
  app.handlers["deliverable.resolve"] = () => ({ kind: "retained", path: "/retained/exact", sha256: "hash-9" });
  window.dispatchEvent(new Event("focus"));
  const made = await screen.findByRole("region", { name: "Made" });
  const rows = await within(made).findAllByRole("listitem");
  const copied: string[] = [];
  vi.spyOn(app, "clipboardWrite").mockImplementation(async (text: string) => { copied.push(text); });
  fireEvent.contextMenu(rows[1]!);
  await app.pickMenu("Copy");
  expect(JSON.parse(copied[0]!.split("\n").slice(2).join("\n")).record).toEqual(records[1]);
  expect(app.calls.filter(call => call.method === "deliverable.resolve").map(call => call.params)).toEqual([{ project: "project-original", id: "publication-9" }]);
  expect(app.openedTargets).toEqual([]);
});

it("u3299d_named_rows_keep_recorded_targets_publication", async () => {
  const { app, connected } = await mountAskBar();
  connected.showView("made");
  app.handlers["deliverable.list"] = () => [published(7), published(9)];
  app.handlers["deliverable.resolve"] = ({ id }) => ({ kind: "retained", path: `/retained/${id}`, sha256: "exact-hash" });
  window.dispatchEvent(new Event("focus"));
  const made = await screen.findByRole("region", { name: "Made" });
  const rows = await within(made).findAllByRole("listitem");

  for (const row of rows) {
    fireEvent.click(within(row).getByRole("button"));
    await waitFor(() => expect(made.getAttribute("aria-busy")).toBe("false"));
  }

  expect(app.calls.filter(call => call.method === "deliverable.resolve").map(call => call.params)).toEqual([
    { project: "project-original", id: "publication-7" }, { project: "project-original", id: "publication-9" },
  ]);
  expect(app.openedTargets).toEqual([{ kind: "path", path: "/retained/publication-7", line: null }, { kind: "path", path: "/retained/publication-9", line: null }]);
});
