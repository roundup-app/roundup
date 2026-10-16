import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { mountPane, subscribed } from "./paneHarness";
import { info, node, terminal } from "../testing/nodes";

const decoded = (chunks: Uint8Array[]): string[] => chunks.map((chunk) => new TextDecoder().decode(chunk));

afterEach(cleanup);

describe("u11 one emulator per Terminal", () => {
  it("u11_only_the_selected_terminal_is_sent_output_and_it_reaches_its_emulator_in_order", async () => {
    const { app, connected, emulators } = await mountPane([node("a"), node("b")], [info("t-a"), info("t-b")]);

    connected.rail.select("a");
    await subscribed(app, "t-a");
    app.emitOutput("t-a", "one");
    app.emitOutput("t-b", "elsewhere");
    app.emitOutput("t-a", "two");

    await vi.waitFor(() => expect(decoded(emulators.get("t-a")?.written ?? [])).toEqual(["one", "two"]));
    expect([emulators.has("t-b"), app.outputSubscriptions.map((subscription) => subscription.id)]).toEqual([false, ["t-a"]]);
  });

  it("u11_selecting_a_row_shows_its_emulator_and_no_other", async () => {
    const { connected, emulators, container } = await mountPane([node("a"), node("b")], [info("t-a"), info("t-b")]);

    connected.rail.select("b");

    expect([emulators.get("t-b")?.host?.textContent, container.querySelector(".pane-screen")?.textContent]).toEqual([
      "t-b",
      "t-b",
    ]);
  });

  it("u11_selecting_a_group_shows_no_emulator", async () => {
    const { connected, container } = await mountPane([node("a"), node("g", { kind: "workstream", status: null, terminal_id: null })]);

    connected.rail.select("a");
    connected.rail.select("g");

    expect(container.querySelector(".pane-screen")?.textContent).toBe("");
  });

  it("u11_a_refused_output_subscription_shows_one_error_line", async () => {
    const { app, connected } = await mountPane([node("a")], [info("t-a")]);

    app.outputFailure = new RpcError(-32603, "channel refused");
    connected.rail.select("a");

    const alert = await screen.findByRole("alert", { name: "terminal.output: channel refused" });

    expect([alert.tagName, alert.querySelector('svg.lucide-x[aria-hidden="true"]') !== null]).toEqual(["P", true]);
  });

  it("u11_closing_the_pane_disposes_every_emulator", async () => {
    const { connected, emulators } = await mountPane([terminal("a")], [info("t-a")]);

    connected.rail.select("a");
    cleanup();

    expect(emulators.get("t-a")?.disposed).toBe(true);
  });
});
