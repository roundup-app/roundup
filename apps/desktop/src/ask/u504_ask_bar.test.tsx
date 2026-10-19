import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
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
