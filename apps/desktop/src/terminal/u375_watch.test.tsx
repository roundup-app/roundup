import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Decision } from "@contracts/decision/Decision";
import { RpcError } from "../app/seam";
import { callsTo } from "./paneHarness";
import { agent, door, event } from "../testing/nodes";
import { message, mountThread, sent } from "../thread/threadFixture";
import { USER } from "../testing/nodes";

const tree = () => [door("workstream", "idle", "idle", { name: "lead" }), agent("a", "working", "x", { parent: "workstream", name: "ann", terminal_id: "t-a" })];

/** U187's one release of a Door's Takeover (`takeover.end` on the Door) comes first and is not these tests' subject. */
const calls = (app: { calls: { method: string }[] }, prefix: string) => app.calls.filter((call) => call.method.startsWith(prefix)).map((call) => call.method).slice(prefix === "takeover." ? 1 : 0);

const band = () => document.querySelector(".pane-watch");

const bytes = (...values: number[]) => Uint8Array.from(values);

const open: Decision = { id: "d1", agent: "a", tool: "Bash", args: JSON.stringify({ command: "rm -rf build" }), opened_at: 1, answerable: true };

const mountWatch = async (decisions: Decision[] = []) => {
  const mounted = await mountThread(tree(), { select: "a", prepare: (app) => {
    app.handlers["decision.list"] = () => decisions;
    app.handlers["decision.answer"] = () => null;
  } });

  return mounted;
};

afterEach(cleanup);

describe("u375 the user watches an Agent's screen without taking it over", () => {
  it("u375_a_selected_agent_opens_in_watch_and_no_input_reaches_the_terminal", async () => {
    const { app, emulators } = await mountWatch();
    const emulator = emulators.get("t-a")!;

    emulator.type(bytes(108, 13));
    emulator.paste("ls");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    app.dropFiles({ phase: "over", paths: [], x: 5, y: 5 });
    app.dropFiles({ phase: "drop", paths: ["/tmp/a.png"], x: 5, y: 5 });

    expect(callsTo(app, "terminal.write")).toEqual([]);
    expect(emulator.written).toEqual([]);
    expect(document.querySelector(".drop-over")).toBeNull();
    expect(calls(app, "takeover.")).toEqual([]);
    expect(document.activeElement?.closest("[data-terminal]")).toBeNull();
  });

  it("u375_the_watch_band_names_the_agent_and_offers_take_over", async () => {
    await mountWatch();

    expect(band()?.textContent).toContain("Watching ann: read-only");
    expect(screen.getByRole("button", { name: "take over" }).tagName).toBe("BUTTON");
    expect(document.querySelector(".pane-takeover")).toBeNull();
  });

  it("u375_watch_scrolls_copies_and_holds_no_message", async () => {
    const { app, emulators } = await mountWatch();
    const emulator = emulators.get("t-a")!;

    emulator.scroll(false);
    await vi.waitFor(() => expect(screen.getByRole("button", { name: /latest/ })).not.toBeNull());
    emulator.selectedText = "picked";

    const written: string[] = [];

    Object.assign(navigator, { clipboard: { writeText: async (text: string) => { written.push(text); } } });
    fireEvent.keyDown(document.querySelector(".pane-screen > *")!, { key: "c", metaKey: true });
    await vi.waitFor(() => expect(written).toEqual(["picked"]));

    expect(calls(app, "agent.interrupt")).toEqual([]);
    expect(calls(app, "takeover.")).toEqual([]);
    expect(callsTo(app, "terminal.resize").length).toBeGreaterThan(0);

    // B1, B6: another Actor's Message to the watched Agent shows with the status the Daemon reports, and Watch begins no Takeover to hold it.
    app.emit(sent(message(8, { from: USER, to: "a", body: "second", status: "delivered" })));
    fireEvent.click(screen.getAllByRole("treeitem").find((row) => row.getAttribute("data-id") === "workstream")!);
    await vi.waitFor(() => expect(document.querySelector("[data-message-body]")?.textContent).toBe("second"));
    expect(document.querySelector("[data-message-body]")?.getAttribute("data-status")).toBe("delivered");
    expect(calls(app, "takeover.")).toEqual([]);
    expect(callsTo(app, "terminal.write")).toEqual([]);
  });

  it("u375_take_over_begins_once_and_end_returns_to_watch", async () => {
    const { app } = await mountWatch();

    fireEvent.click(screen.getByRole("button", { name: "take over" }));

    await vi.waitFor(() => expect(document.querySelector(".pane-takeover")).not.toBeNull());
    expect(band()).toBeNull();
    expect(calls(app, "takeover.")).toEqual(["takeover.begin"]);

    fireEvent.keyDown(document.body, { key: "¡", code: "Digit0", altKey: true });

    await vi.waitFor(() => expect(band()).not.toBeNull());
    expect(calls(app, "takeover.")).toEqual(["takeover.begin", "takeover.end"]);
  });

  it("u375_alt_n_on_the_agents_row_begins_once_focuses_the_emulator_and_swaps_the_band", async () => {
    const { app } = await mountWatch();

    fireEvent.keyDown(document.body, { key: "¡", code: "Digit2", altKey: true });

    await vi.waitFor(() => expect(document.querySelector(".pane-takeover")).not.toBeNull());
    expect(band()).toBeNull();
    expect(calls(app, "takeover.")).toEqual(["takeover.begin"]);
    expect(document.activeElement?.closest("[data-terminal]")).not.toBeNull();
  });

  it("u375_take_over_focuses_the_emulator_and_selecting_another_row_ends_it", async () => {
    const { app, emulators } = await mountWatch();
    const focus = vi.fn();

    emulators.get("t-a")!.focus = focus;
    fireEvent.click(screen.getByRole("button", { name: "take over" }));
    await vi.waitFor(() => expect(document.querySelector(".pane-takeover")).not.toBeNull());
    expect(focus).toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("treeitem").find((row) => row.getAttribute("data-id") === "workstream")!);
    await vi.waitFor(() => expect(band()).toBeNull());
    expect(calls(app, "takeover.")).toContain("takeover.end");
  });

  it("u375_a_conflict_stays_in_watch_with_the_failure_line", async () => {
    const { app } = await mountWatch();

    app.handlers["takeover.begin"] = () => {
      throw new RpcError(-32000, "ann is already taken over");
    };

    fireEvent.click(screen.getByRole("button", { name: "take over" }));

    await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toContain("ann is already taken over"));
    expect(band()).not.toBeNull();
    expect(document.querySelector(".pane-takeover")).toBeNull();
  });

  it("u375_a_decision_card_and_the_composer_hold_in_watch", async () => {
    const { app } = await mountWatch([open]);

    await vi.waitFor(() => expect(document.querySelector(".decision-card")).not.toBeNull());
    expect(document.querySelector(".decision-card")!.textContent).toContain("rm -rf build");
    expect(document.querySelector("[data-thread-input]")).not.toBeNull();
    expect(band()).not.toBeNull();

    fireEvent.click(within(document.querySelector<HTMLElement>(".decision-card")!).getByRole("button", { name: "allow" }));
    await vi.waitFor(() => expect(app.calls.filter((call) => call.method === "decision.answer")).toHaveLength(1));
  });

  it("u375_a_reload_opens_in_watch", async () => {
    await mountWatch();

    expect(band()).not.toBeNull();
    expect(document.querySelector("[data-takeover]")).toBeNull();
  });

  it("u375_u12_typing_holds_in_a_takeover", async () => {
    const { app, emulators } = await mountWatch();

    fireEvent.click(screen.getByRole("button", { name: "take over" }));
    await vi.waitFor(() => expect(document.querySelector(".pane-takeover")).not.toBeNull());

    emulators.get("t-a")!.type(bytes(108));

    await vi.waitFor(() => expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-a", data: "bA==" }]));
  });

  it("u375_an_exited_terminal_shows_no_band", async () => {
    const { app } = await mountWatch();

    app.emit(event({ name: "terminal.exited", data: { id: "t-a", code: 0 } }));

    await vi.waitFor(() => expect(band()).toBeNull());
  });
});
