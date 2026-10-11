import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, door, terminal } from "../testing/nodes";
import { changed, openTabs, tab, treeOf } from "./stripFixture";

afterEach(cleanup);

const markOf = (name: string) => tab(name).querySelector(".tab-mark");

describe("u180 the Tab mark", () => {
  it("u180_error_over_needs_you", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x"), agent("b", "error", "x")] });

    expect(markOf("api")?.querySelector(".glyph")?.getAttribute("data-form")).toBe("square-x");
    expect(markOf("api")?.querySelector(".glyph")?.getAttribute("data-tone")).toBe("red");
  });

  it("u180_needs_you_alone_is_amber", async () => {
    await openTabs({ api: [agent("a", "needs-you", "x")] });

    expect(markOf("api")?.querySelector(".glyph")?.getAttribute("data-form")).toBe("disc-bang");
    expect(markOf("api")?.querySelector(".glyph")?.getAttribute("data-tone")).toBe("amber");
  });

  it("u180_working_blocked_idle_and_done_give_nothing", async () => {
    await openTabs({ api: ([["a0", "working"], ["a1", "blocked"], ["a2", "idle"], ["a3", "done"]] as const).map(([id, kind]) => agent(id, kind, "x")) });

    expect(markOf("api")).toBeNull();
  });

  it("u180_a_terminal_gives_nothing_and_a_door_counts", async () => {
    await openTabs({ api: [terminal("t")], web: [door("lead", "needs-you", "x")] });

    expect(markOf("api")).toBeNull();
    expect(markOf("web")?.querySelector(".glyph")?.getAttribute("data-form")).toBe("disc-bang");
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

  it("u398_no_tab_shows_a_circle_character", async () => {
    await openTabs({ api: [agent("a", "error", "x")], web: [agent("b", "needs-you", "x")] });

    expect([tab("api").textContent, tab("web").textContent]).toEqual(["api", "web"]);
    expect([markOf("api")?.getAttribute("aria-label"), markOf("web")?.getAttribute("aria-label")]).toEqual(["error", "needs you"]);
  });

  it("u398_a_tab_mark_is_the_kind_glyph", async () => {
    await openTabs({ api: [agent("a", "error", "x")] });

    expect(markOf("api")?.querySelectorAll(".glyph.ink[aria-hidden=true] svg")).toHaveLength(1);
  });
});
