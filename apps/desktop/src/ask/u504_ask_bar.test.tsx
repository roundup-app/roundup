import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
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

  it("u504_enter_shows_the_row_before_send_returns", async () => {
    const { app } = await mountAskBar();
    let answer!: (value: Ask) => void;

    app.handlers["ask.send"] = () => new Promise<Ask>((resolve) => { answer = resolve; });
    type("fix the login bug");
    const enter = press("Enter", {}, input()!);

    expect(enter.defaultPrevented).toBe(true);
    expect(input()!.value).toBe("");
    expect(rowTexts()).toEqual(["fix the login bug |  | Placing"]);
    expect(sent(app)).toEqual([{ text: "fix the login bug" }]);

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

  it("u504_shift_enter_adds_a_line", async () => {
    const { app } = await mountAskBar();

    type("one");
    const line = press("Enter", { shiftKey: true }, input()!);

    expect(line.defaultPrevented).toBe(false);
    expect(sent(app)).toEqual([]);
    expect(input()!.value).toBe("one");
  });
});
