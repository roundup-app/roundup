import { cleanup, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { DaemonExit } from "../app/seam";
import { rowGlyph as glyphOf, mountRail, rowNames, rowOf } from "./railFixture";
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
});
