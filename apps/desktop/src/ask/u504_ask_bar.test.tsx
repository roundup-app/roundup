import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Ask } from "@contracts/ask/Ask";
import { RpcError } from "../app/seam";
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
    expect(sent(app)).toEqual([expect.objectContaining({ text: "fix the login bug", submission: expect.any(String) })]);

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


it("u2773b_ask_outcomes_keep_their_submission_identity_out_of_order", async () => {
  const { app, connected } = await mountAskBar();
  let accept!: (value: Ask) => void;
  let refuse!: (error: Error) => void;
  app.handlers["ask.send"] = (params) => params.submission === "a"
    ? new Promise<Ask>((resolve) => { accept = resolve; })
    : new Promise<Ask>((_, reject) => { refuse = reject; });
  const a = connected.asks.send(" exact 🌿\n ", { submission: "a", workstream: "ops" });
  const b = connected.asks.send("newer", { submission: "b" });
  const error = new RpcError(-32003, "conflict");
  refuse(error);
  expect(await b).toEqual({ kind: "refused", submission: "b", error });
  const accepted = { ...ask("accepted", 1, [], " exact 🌿\n "), submission: "a", workstream: "ops" };
  accept(accepted);
  expect(await a).toEqual({ kind: "acknowledged", submission: "a", ask: accepted });
  expect(sent(app)).toEqual([
    { text: " exact 🌿\n ", submission: "a", workstream: "ops" },
    { text: "newer", submission: "b" },
  ]);
});

it.each([new RpcError(-32004, "connection lost"), new RpcError(-32603, "timeout"), new Error("disconnected")])("u2773b_ask_transport_loss_remains_unknown", async (error) => {
  const { app, connected } = await mountAskBar();
  app.handlers["ask.send"] = () => Promise.reject(error);
  expect(await connected.asks.send("exact", { submission: "a" })).toEqual({ kind: "unknown", submission: "a", error });
  expect(await connected.asks.reconcile("a")).toBeNull();
  expect(sent(app)).toHaveLength(1);
});

it("u2773b_ask_reconciliation_reads_acceptance_without_sending", async () => {
  const { app, connected } = await mountAskBar();
  const accepted = { ...ask("accepted", 1, [], "same"), submission: "a" };
  app.handlers["ask.list"] = () => [accepted, { ...ask("other", 2, [], "same"), submission: "b" }];
  expect(await connected.asks.reconcile("a")).toEqual(accepted);
  expect(sent(app)).toEqual([]);
});
