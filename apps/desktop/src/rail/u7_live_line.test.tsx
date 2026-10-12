import { cleanup, fireEvent } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Kind } from "@contracts/Kind";
import { glyphOf, shownLiveLine, mountRail, rowOf } from "./railFixture";
import { agent, MINUTE, NOW, terminal } from "../testing/nodes";

afterEach(cleanup);

const asking = (over = {}) =>
  agent("gateway", "needs-you", "asks: keep v1 routes?", {
    status: { kind: "needs-you", label: "asks: keep v1 routes?", since: NOW - 4 * MINUTE },
    ...over,
  });

describe("u7 live line", () => {
  it("u7_an_agents_live_line_is_its_label_alone", async () => {
    await mountRail([asking()]);

    expect(shownLiveLine("gateway")).toBe("asks: keep v1 routes?");
  });

  it("u7_a_working_agents_live_line_is_hidden_until_hover", async () => {
    await mountRail([agent("docs", "working", "writing docs/auth.md")]);
    const before = shownLiveLine("docs");

    fireEvent.mouseEnter(rowOf("docs"));

    expect([before, shownLiveLine("docs")]).toEqual([null, "writing docs/auth.md"]);
  });

  it("u7_the_live_line_hides_again_when_the_pointer_leaves", async () => {
    await mountRail([agent("docs", "working", "w")]);
    fireEvent.mouseEnter(rowOf("docs"));

    fireEvent.mouseLeave(rowOf("docs"));

    expect(shownLiveLine("docs")).toBeNull();
  });

  it("u7_a_working_agents_live_line_shows_on_selection", async () => {
    const { rail } = await mountRail([agent("docs", "working", "w")]);

    rail.select("docs");

    expect(shownLiveLine("docs")).toBe("w");
  });

  it.each<Kind>(["blocked", "needs-you", "error"])("u7_a_%s_agents_live_line_shows_unprompted", async (kind) => {
    await mountRail([agent("a", kind, "label")]);

    expect(shownLiveLine("a")).toBe("label");
  });

  it.each<Kind>(["working", "idle", "done"])("u7_a_%s_agents_live_line_is_not_unprompted", async (kind) => {
    await mountRail([agent("a", kind, "label")]);

    expect(shownLiveLine("a")).toBeNull();
  });

  it("u7_a_running_terminal_has_no_live_line_even_when_selected", async () => {
    const { rail } = await mountRail([terminal("dev")]);

    rail.select("dev");

    expect(shownLiveLine("dev")).toBeNull();
  });

  it.each<[Kind, string]>([
    ["needs-you", "amber"],
    ["error", "red"],
  ])("u7_a_%s_agents_name_and_glyph_are_in_ink", async (kind, tone) => {
    await mountRail([agent("a", kind, "l")]);
    const name = rowOf("a").querySelector(".name");

    expect([name?.className, name?.getAttribute("data-tone"), glyphOf("a").className]).toEqual([
      "name ink",
      tone,
      "glyph ink",
    ]);
  });

  it("u7_a_working_agents_name_carries_no_ink", async () => {
    await mountRail([agent("a", "working", "l")]);

    expect(rowOf("a").querySelector(".name")?.className).toBe("name");
  });
});
