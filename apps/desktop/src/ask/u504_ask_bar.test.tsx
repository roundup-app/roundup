import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { event, workstream } from "../testing/nodes";
import { RpcError } from "../app/seam";
import type { Ask } from "@contracts/ask/Ask";
import { ask, input, mountAskBar, press, rowTexts } from "./askFixture";

afterEach(cleanup);

const type = (text: string) => fireEvent.input(input()!, { target: { value: text } });

const sent = (app: { calls: { method: string; params: unknown }[] }) => app.calls.filter((call) => call.method === "ask.send").map((call) => call.params);

describe("u504 the Ask bar", () => {
  it("u504_the_home_screen_is_the_ask_bar", async () => {
    const { connected } = await mountAskBar();

    expect(input()).not.toBeNull();

    connected.rail.select("lead");
    await waitFor(() => expect(input()).toBeNull());

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

  it("u504_enter_shows_the_row_before_send_returns", async () => {
    const { app } = await mountAskBar();
    let answer!: (value: Ask) => void;

    app.handlers["ask.send"] = () => new Promise<Ask>((resolve) => { answer = resolve; });
    type("fix the login bug");
    const enter = press("Enter", {}, input()!);

    expect(enter.defaultPrevented).toBe(true);
    expect(input()!.value).toBe("");
    expect(rowTexts()).toEqual(["fix the login bug |  | Placing"]);
    expect(sent(app)).toEqual([{ text: "fix the login bug", submission: expect.any(String) }]);

    answer(ask("a1", 1, [{ text: "fix the login bug", placement: { kind: "routed", workstream: "ops" }, state: "queued" }]));
    await waitFor(() => expect(rowTexts()).toEqual(["fix the login bug | ops | Queued for the supervisor"]));
  });

  it("u504_at_lists_workstreams_and_writes_the_name", async () => {
    const { app } = await mountAskBar();

    input()!.focus();
    type("@");
    await waitFor(() => expect([...document.querySelectorAll(".app-mentions [role=option]")].map((item) => item.textContent)).toEqual(["lead", "ops", "docs"]));

    type("@OP");
    await waitFor(() => expect([...document.querySelectorAll(".app-mentions [role=option]")].map((item) => item.textContent)).toEqual(["ops"]));

    press("Enter", {}, input()!);
    await waitFor(() => expect(input()!.value).toBe("@ops "));
    expect(sent(app)).toEqual([]);
    expect(document.querySelector(".app-mentions")).toBeNull();
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
  });

  it("u504_click_picks_a_workstream", async () => {
    await mountAskBar();
    type("@");

    const option = await waitFor(() => {
      const item = document.querySelector<HTMLElement>(".app-mentions [role=option]");

      expect(item).not.toBeNull();

      return item!;
    });

    fireEvent.click(option);
    await waitFor(() => expect(input()!.value).toBe("@lead "));
    expect(document.activeElement).toBe(input());
    expect(document.querySelector(".app-mentions")).toBeNull();
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

  if (outcome === "acknowledged") accept(ask("accepted", 1, []));
  else reject(outcome === "refused" ? new RpcError(-32003, "refused") : new Error("lost reply"));
  await waitFor(() => expect(first.connected.drafts.list().some(draft => draft.status === "pending")).toBe(false));
  expect(input()!.value).toBe("  B e\u0301\n ");
  expect(first.connected.drafts.list().map(draft => [draft.value.text, draft.status])).toEqual(outcome === "acknowledged"
    ? [["  B e\u0301\n ", "draft"]] : [["  A 🌿\n ", outcome === "refused" ? "failed" : "unknown"], ["  B e\u0301\n ", "draft"]]);
  const path = first.connected.project.path;
  first.unmount();
  const reopened = await mountAskBar([], null, undefined, false, path);
  expect(input()!.value).toBe("  B e\u0301\n ");
  expect(sent(reopened.app)).toEqual([]);
  const older = reopened.connected.drafts.list().find(draft => draft.status !== "draft");

  if (older) {
    fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard this revision" }));
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
  expect(sent(app)).toEqual([{ text: "failed A", submission: expect.any(String) }, { text: "pending B", submission: expect.any(String) }]);
  accept(ask("accepted", 1, []));
});

it("u2773a_ask_captures_the_longest_name_case_insensitively", async () => {
  const { app } = await mountAskBar([], null, [workstream("short", { name: "Alpha" }), workstream("long", { name: "Alpha Beta" })]);
  type("@Alpha ");
  type("@aLPHa bETA exact 🌿");
  press("Enter", {}, input()!);
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
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: clipboard } });
  const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });

  try {
    type(exact);
    expect(input()!.value).toBe(exact);
    expect(screen.getByRole("alert").textContent).toContain(mounted.connected.project.path);
    expect(screen.getByRole("alert").textContent).toContain("Ask");
    fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy text" }));
    expect(clipboard).toHaveBeenCalledWith(exact);
    expect(input()!.value).toBe(exact);
    writes.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry storage only" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(sent(mounted.app)).toEqual([]);
    const path = mounted.connected.project.path;
    mounted.unmount();
    const reopened = await mountAskBar([], null, undefined, false, path);
    expect(input()!.value).toBe(exact);
    reopened.connected.rail.select("ann");
    fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard this revision" }));
    reopened.connected.rail.select(null);
    expect(input()!.value).toBe("");
    expect(sent(reopened.app)).toEqual([]);
    reopened.unmount();
    await mountAskBar([], null, undefined, false, path);
    expect(input()!.value).toBe("");
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
  acceptB(ask("accepted-b", 1, []));
  await waitFor(() => expect(connected.drafts.list().map(draft => draft.value.text)).toEqual([" A 🌿\n ", " C newest\n "]));
  refuseA(new RpcError(-32003, "older refused"));
  await screen.findByRole("alert");
  expect(input()!.value).toBe(" C newest\n ");
  expect(connected.drafts.list().map(draft => [draft.value.text, draft.status])).toEqual([[" A 🌿\n ", "failed"], [" C newest\n ", "draft"]]);
  expect(sent(app)).toHaveLength(2);
});
