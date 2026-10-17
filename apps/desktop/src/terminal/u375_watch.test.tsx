import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Decision } from "@contracts/decision/Decision";
import { RpcError } from "../app/seam";
import { callsTo } from "./paneHarness";
import { agent, door, event, NOW } from "../testing/nodes";
import { mountCentre } from "../testing/centreFixture";

const tree = () => [door("workstream", "idle", "idle", { name: "lead" }), agent("a", "working", "x", { parent: "workstream", name: "ann", terminal_id: "t-a" })];

const calls = (app: { calls: { method: string }[] }, prefix: string) => app.calls.filter((call) => call.method.startsWith(prefix)).map((call) => call.method);

const band = () => document.querySelector(".pane-watch");

const bytes = (...values: number[]) => Uint8Array.from(values);

const open: Decision = { id: "d1", agent: "a", tool: "Bash", args: JSON.stringify({ command: "rm -rf build" }), opened_at: 1, answerable: true };

const mountWatch = async (decisions: Decision[] = []) => {
  const mounted = await mountCentre(tree(), { select: "a", prepare: (app) => {
    app.handlers["decision.list"] = () => decisions;
    app.handlers["decision.answer"] = () => null;
  } });

  // As u162 does: jsdom's box is 0×0, so a drop at (5, 5) would never reach the Watch gate.
  document.querySelector<HTMLElement>(".pane-body")!.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);

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
    // The emulator records its own paste("ls") above; a dropped path would add a second entry.
    expect(emulator.pasted).toEqual(["ls"]);
    expect(document.querySelector(".drop-over")).toBeNull();
    expect(calls(app, "takeover.")).toEqual([]);
    expect(document.activeElement?.closest("[data-terminal]")).toBeNull();
  });

  it("u375_the_watch_band_names_the_agent_and_offers_take_over", async () => {
    await mountWatch();

    expect(band()?.textContent).toContain("Watching ann: Read-only");
    expect(screen.getByRole("button", { name: "Take control" }).tagName).toBe("BUTTON");
    expect(document.querySelector(".pane-takeover")).toBeNull();
  });

  it("u375_watch_scrolls_and_copies", async () => {
    const { app, emulators } = await mountWatch();
    const emulator = emulators.get("t-a")!;

    emulator.scroll(false);
    await vi.waitFor(() => expect(screen.getByRole("button", { name: /Latest/ })).not.toBeNull());
    emulator.selectedText = "picked";

    const written: string[] = [];

    Object.assign(navigator, { clipboard: { writeText: async (text: string) => { written.push(text); } } });
    fireEvent.keyDown(document.querySelector(".pane-screen > *")!, { key: "c", metaKey: true });
    await vi.waitFor(() => expect(written).toEqual(["picked"]));

    expect(calls(app, "agent.interrupt")).toEqual([]);
    expect(calls(app, "takeover.")).toEqual([]);
    expect(callsTo(app, "terminal.resize").length).toBeGreaterThan(0);

    expect(callsTo(app, "terminal.write")).toEqual([]);
  });

  it.each(["a", "nested"])("u467_each_child_keeps_takeover_and_give_back_controls (%s)", async (id) => {
    const { app, connected } = await mountCentre([...tree(), agent("nested", "working", "x", { parent: "a", name: "nested", terminal_id: "t-nested" })], { select: id });
    const take = screen.getByRole("button", { name: "Take control" });
    expect(take.tagName).toBe("BUTTON");
    fireEvent.click(take);
    await connected.takeover.end("not-taken");

    expect(connected.takeover.taken()).toBe(id);
    expect(document.activeElement?.closest("[data-terminal]")?.getAttribute("data-terminal")).toBe(`t-${id}`);
    const give = screen.getByRole("button", { name: "Give control back" });
    expect(give.tagName).toBe("BUTTON");
    fireEvent.click(give);
    await connected.takeover.end("not-taken");

    expect(connected.takeover.taken()).toBeNull();
    expect(app.calls.filter((call) => call.method.startsWith("takeover."))).toEqual([
      { method: "takeover.begin", params: { agent: id } },
      { method: "takeover.end", params: { agent: id } },
    ]);
    expect(band()).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Take control" }));
  });

  it("u467_selection_does_not_end_takeover", async () => {
    const { app, connected, emulators } = await mountWatch();

    fireEvent.click(screen.getByRole("button", { name: "Take control" }));
    await screen.findByText("Control: Typing goes straight to ann");

    fireEvent.click(screen.getAllByRole("treeitem").find((row) => row.getAttribute("data-id") === "workstream")!);
    expect(connected.rail.selected()).toBe("workstream");
    // Takeover calls serialize: this no-op drains any release queued by selection.
    await connected.takeover.end("not-taken");
    expect(connected.takeover.taken()).toBe("a");
    fireEvent.click(screen.getAllByRole("treeitem").find((row) => row.getAttribute("data-id") === "a")!);

    await screen.findByText("Control: Typing goes straight to ann");
    expect(calls(app, "takeover.")).toEqual(["takeover.begin"]);
    emulators.get("t-a")!.type(bytes(108));
    await vi.waitFor(() => expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-a", data: "bA==" }]));
  });

  it("u375_a_conflict_stays_in_watch_with_the_failure_line", async () => {
    const { app } = await mountWatch();

    app.handlers["takeover.begin"] = () => {
      throw new RpcError(-32000, "ann is already taken over");
    };

    fireEvent.click(screen.getByRole("button", { name: "Take control" }));

    await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toContain("ann is already taken over"));
    expect(band()).not.toBeNull();
    expect(document.querySelector(".pane-takeover")).toBeNull();
  });

  it("u467_takeover_failure_preserves_the_child_and_shows_the_error", async () => {
    const { app, connected, emulators } = await mountWatch();
    fireEvent.click(screen.getByRole("button", { name: "Take control" }));
    await connected.takeover.end("not-taken");
    app.handlers["takeover.end"] = () => { throw new RpcError(-32000, "Give back failed: connection lost"); };

    fireEvent.click(screen.getByRole("button", { name: "Give control back" }));

    await screen.findByText("Give back failed: connection lost");
    expect(connected.takeover.taken()).toBe("a");
    expect(connected.rail.selected()).toBe("a");
    expect(screen.getByRole("button", { name: "Give control back" })).not.toBeNull();
    emulators.get("t-a")!.type(bytes(108));
    await vi.waitFor(() => expect(callsTo(app, "terminal.write")).toEqual([{ id: "t-a", data: "bA==" }]));
  });

  it("u375_a_decision_card_holds_in_watch", async () => {
    const { app } = await mountWatch([open]);

    await vi.waitFor(() => expect(document.querySelector(".decision-card")).not.toBeNull());
    expect(document.querySelector(".decision-card")!.textContent).toContain("rm -rf build");
    expect(band()).not.toBeNull();

    fireEvent.click(within(document.querySelector<HTMLElement>(".decision-card")!).getByRole("button", { name: "Allow" }));
    await vi.waitFor(() => expect(app.calls.filter((call) => call.method === "decision.answer")).toHaveLength(1));
  });


  it("u468_a_child_that_needs_you_takes_its_answer_in_its_terminal", async () => {
    const { app, connected, emulators } = await mountCentre(tree(), { select: "workstream" });

    const status = (kind: "needs-you" | "working", revision: string) =>
      app.emit(event({ name: "agent.status", data: { id: "a", attempt: "1", status_revision: revision, status: { kind, label: kind, since: NOW } } }));

    status("needs-you", "2");
    // U412: activating the child's Toast selects its row, as a click on the row does.
    connected.rail.select("a");

    await vi.waitFor(() => expect(document.activeElement?.closest('[data-terminal="t-a"]')).not.toBeNull());
    expect(band()).toBeNull();

    emulators.get("t-a")!.type(bytes(49, 13));

    await vi.waitFor(() => expect(callsTo(app, "terminal.write")).toHaveLength(1));
    expect(callsTo(app, "terminal.write")[0]).toMatchObject({ id: "t-a" });
    expect(calls(app, "takeover.")).toEqual([]);

    status("working", "3");

    await vi.waitFor(() => expect(band()).not.toBeNull());
    emulators.get("t-a")!.type(bytes(50));
    expect(callsTo(app, "terminal.write")).toHaveLength(1);
  });

  it("u375_an_exited_terminal_shows_no_band", async () => {
    const { app } = await mountWatch();

    app.emit(event({ name: "terminal.exited", data: { id: "t-a", code: 0 } }));

    await vi.waitFor(() => expect(band()).toBeNull());
  });
});
