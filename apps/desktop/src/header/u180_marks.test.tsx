import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, door, terminal } from "../testing/nodes";
import { changed, openTabs, tab, treeOf } from "./stripFixture";

afterEach(cleanup);

const markOf = (name: string) => tab(name).querySelector(".tab-mark .glyph");

describe("u180 the Tab mark", () => {
  it("u180_error_over_needs_you", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x"), agent("b", "error", "x")] });

    expect(markOf("api")?.getAttribute("data-drawing")).toBe("cross");
    expect(markOf("api")?.getAttribute("data-tone")).toBe("red");
  });

  it("u180_needs_you_alone_is_amber", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x")] });

    expect(markOf("api")?.getAttribute("data-drawing")).toBe("disc");
    expect(markOf("api")?.getAttribute("data-tone")).toBe("amber");
  });

  it("u180_working_blocked_idle_and_done_give_nothing", async () => {
    await openTabs({ api: ([["a0", "working"], ["a1", "blocked"], ["a2", "idle"], ["a3", "done"]] as const).map(([id, kind]) => agent(id, kind, "x")) });

    expect(markOf("api")).toBeNull();
  });

  it("u180_a_terminal_gives_nothing_and_a_door_counts", async () => {
    await openTabs({ api: [terminal("t")], web: [door("lead", "needs-you", "x")] });

    expect(markOf("api")).toBeNull();
    expect(markOf("web")?.getAttribute("data-drawing")).toBe("disc");
  });

  it("u180_a_background_project_has_its_mark_and_never_a_number_or_a_plain_ring", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x"), agent("b", "needs-you", "x")], web: [] });

    expect(tab("api").textContent).toBe("api");
    expect(screen.getByRole("banner").textContent).not.toContain("○");
  });

  it("u180_the_mark_clears_when_the_need_is_answered", async () => {
    const { app } = await openTabs({ api: [agent("a", "needs-you", "x")], web: [] });

    treeOf(app, "api", [agent("a", "working", "x")]);
    await changed(app, "api");

    await waitFor(() => expect(markOf("api")).toBeNull());
  });
});
