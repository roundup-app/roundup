import { cleanup, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { DaemonExit } from "../app/seam";
import rail from "./styles.css?inline";
import {
  applyFilter,
  colourOf,
  contrastRatio,
  greyedRailFilter,
  loadTokens,
  withStylesheets,
} from "../testing/contrast";
import { glyphOf, mountRail, rowNames, rowOf } from "./railFixture";
import { agent } from "../testing/nodes";

afterEach(cleanup);

describe("u25 the Daemon is gone", () => {
  it("u25_the_rail_is_dimmed_and_every_row_keeps_its_glyph_and_title", async () => {
    const [exit, setExit] = createSignal<DaemonExit | null>(null);

    await mountRail(
      [agent("a", "needs-you", "approve edit"), agent("b", "working", "reading", { order: 1 })],
      [],
      exit,
    );

    const tree = screen.getByRole("tree");
    const before = { glyph: glyphOf("a").getAttribute("aria-label"), line: rowOf("a").title };

    expect(tree.getAttribute("aria-disabled")).toBeNull();
    setExit({ code: 1 });

    expect(tree.getAttribute("aria-disabled")).toBe("true");
    expect(rowNames()).toEqual(["a", "b"]);
    expect({ glyph: glyphOf("a").getAttribute("aria-label"), line: rowOf("a").title }).toEqual(before);
  });

  it.each([
    ["unselected, against the ground", false],
    ["selected, against the band", true],
  ] as const)("u25_the_name_still_clears_4_5_to_1_once_greyed_when_%s", async (_label, selectRow) => {
    const { tokens, ground, selected } = loadTokens();
    const [exit, setExit] = createSignal<DaemonExit | null>(null);

    await withStylesheets(async () => {
      const { rail: connected } = await mountRail([agent("blocker", "blocked", "waits on #4")], [], exit);
      const liveEl = () => rowOf("blocker").querySelector(".name");

      if (selectRow) connected.select("blocker");

      const textBefore = colourOf(liveEl()!, tokens);

      setExit({ code: 1 });
      expect(screen.getByRole("tree").getAttribute("aria-disabled")).toBe("true");

      const filter = greyedRailFilter(rail);
      const text = applyFilter(textBefore, filter);
      const background = selectRow ? applyFilter(selected, filter) : ground;

      expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
