import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import type { Kind } from "@contracts/Kind";
import type { DaemonExit } from "../app/seam";
import railCss from "./styles.css?inline";
import { agent, NOW, workstream } from "../testing/nodes";
import { applyFilter, colourOf, contrastRatio, greyedRailFilter, loadTokens, withStylesheets } from "../testing/contrast";
import { mountRail, rowOf } from "./railFixture";

afterEach(cleanup);

const KINDS: Kind[] = ["needs-you", "error", "blocked", "working", "idle", "done"];

const rowsOfEveryKind = () => KINDS.map((kind, order) => agent(kind, kind, `${kind} label`, { order }));

const nameOf = (name: string): Element => {
  const el = rowOf(name).querySelector(".name");

  if (!el) throw new Error(`no name on ${name}`);

  return el;
};

describe("u87 contrast: Rail", () => {
  it("u87_every_kind_name_meets_4_5_to_1_on_the_ground_and_the_selected_band", async () => {
    const { tokens, sunken, selectedOnSunken } = loadTokens();

    await withStylesheets(async () => {
      const { rail } = await mountRail(rowsOfEveryKind());

      for (const kind of KINDS) {
        expect(contrastRatio(colourOf(nameOf(kind), tokens), sunken), `${kind} on --sunken`).toBeGreaterThanOrEqual(4.5);
        rail.select(kind);
        expect(contrastRatio(colourOf(nameOf(kind), tokens), selectedOnSunken), `${kind} on the band`).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  it("u87_the_ink_names_meet_4_5_to_1", async () => {
    const { tokens, ground, sunken, selected, selectedOnSunken } = loadTokens();

    await withStylesheets(async () => {
      const { rail } = await mountRail(rowsOfEveryKind());

      for (const kind of ["needs-you", "error"]) {
        const ink = () => {
          const name = rowOf(kind).querySelector(".name.ink[data-tone]");

          if (!name) throw new Error(`no Ink name on ${kind}`);

          return name;
        };

        for (const surface of [ground, sunken]) expect(contrastRatio(colourOf(ink(), tokens), surface), kind).toBeGreaterThanOrEqual(4.5);

        rail.select(kind);

        for (const band of [selected, selectedOnSunken]) expect(contrastRatio(colourOf(ink(), tokens), band), kind).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  it.each([
    ["unselected, against --sunken", false],
    ["selected, against the band", true],
  ] as const)("u87_a_greyed_rail_keeps_4_5_to_1_on_every_name when %s", async (_label, selectRow) => {
    const { tokens, sunken, selectedOnSunken } = loadTokens();
    const [exit, setExit] = createSignal<DaemonExit | null>(null);

    await withStylesheets(async () => {
      const { rail } = await mountRail(rowsOfEveryKind(), [], exit);

      setExit({ code: 1 });
      const filter = greyedRailFilter(railCss);

      for (const kind of KINDS) {
        if (selectRow) rail.select(kind);
        const text = applyFilter(colourOf(nameOf(kind), tokens), filter);
        const background = applyFilter(selectRow ? selectedOnSunken : sunken, filter);

        expect(contrastRatio(text, background), kind).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  it("u87_the_promote_word_meets_4_5_to_1_on_the_surface_it_sits_on", async () => {
    const { tokens, sunken } = loadTokens();

    await withStylesheets(async () => {
      await mountRail([workstream("g")]);
      fireEvent.mouseEnter(rowOf("g"));

      expect(contrastRatio(colourOf(screen.getByText(/^start Door$/i), tokens), sunken)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("u87_the_stop_word_meets_4_5_to_1_on_the_surface_it_sits_on", async () => {
    const { tokens, ground } = loadTokens();

    await withStylesheets(async () => {
      await mountRail([agent("a", "working", "busy")]);
      fireEvent.contextMenu(rowOf("a"), { clientX: 120, clientY: 80 });

      expect(contrastRatio(colourOf(screen.getByRole("menuitem", { name: "Stop" }), tokens), ground)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("u87_the_done_fold_line_meets_4_5_to_1_on_sunken", async () => {
    const { tokens, sunken } = loadTokens();

    await withStylesheets(async () => {
      await mountRail([
        agent("old", "done", "finished", { status: { kind: "done", label: "finished", since: NOW - 11 * 60_000 } }),
      ]);
      const foldLine = screen.getByText(/done$/).closest("button");

      if (!foldLine) throw new Error("no fold line button");

      expect(contrastRatio(colourOf(foldLine, tokens), sunken)).toBeGreaterThanOrEqual(4.5);
    });
  });
});
