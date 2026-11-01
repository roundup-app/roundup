import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { mountRail, settled } from "./railFixture";
import { attentionHolders, attentionCounts } from "./attention";
import { sectionsOf } from "../inbox/rows";
import { agent, event, info } from "../testing/nodes";
import { renderTabs, path, tab } from "../header/stripFixture";
import { copy as headerCopy } from "../header/copy";

afterEach(cleanup);

const blocked = { kind: "needs-you", label: "Allow?", since: 0, finished: "0" } as const;

describe("ps12 Terminals count toward attention", () => {
  it("ps12_a_blocked_terminal_counts_in_the_tab_and_the_dock_badge", async () => {
    const { app, rail } = await mountRail([agent("a", "working", "x")], [info("t", { status: blocked })]);

    expect(app.badges.at(-1)).toBe(1);
    expect(attentionCounts(attentionHolders(rail.nodes, rail.terminals()))).toEqual({ needsYou: 1, error: 0 });

    app.emit(event({ name: "terminal.status", data: { id: "t", status: null } }));
    await rail.settled();

    expect(app.badges.at(-1)).toBe(0);
  });

  it("ps12_counts_equal_the_attention_entries_for_agents_and_terminals", async () => {
    const nodes = [agent("a", "needs-you", "x"), agent("b", "error", "x"), agent("c", "working", "x"), agent("d", "error", "x", { terminal_id: "owned" })];
    const dismissed = (node: { id: string }) => node.id === "b";
    const terminals = [info("owned", { status: blocked }), info("w", { status: { ...blocked, kind: "working" } }), info("free", { status: blocked }), info("broken", { status: { ...blocked, kind: "error" } })];
    const { needsYou, error } = attentionCounts(attentionHolders(nodes, terminals, dismissed));

    expect(needsYou + error).toBe(sectionsOf(nodes, [], dismissed, terminals).length);
    expect(needsYou + error).toBe(4);
  });

  it("ps12_the_tab_tooltip_counts_a_free_blocked_terminal", async () => {
    const { app } = renderTabs({ api: [agent("a", "working", "x")], web: [] });

    app.of(path("api")).handlers["terminal.list"] = () => [info("free", { status: blocked })];
    await waitFor(() => expect(tab("api").getAttribute("aria-busy")).toBe("false"), { timeout: 3000 });
    await settled();
    app.of(path("api")).emit(event({ name: "terminal.changed" }));
    await settled();
    await settled();

    fireEvent.pointerOver(tab("api"), { pointerType: "mouse" });

    await waitFor(() => expect(screen.getByRole("tooltip").textContent).toContain(headerCopy.needYouError(1, 0)));
  });
});
