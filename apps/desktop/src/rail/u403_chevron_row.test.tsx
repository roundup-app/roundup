import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Kind } from "@contracts/Kind";
import { agent, workstream } from "../testing/nodes";
import { mountRail, itemOf, rowOf, settled } from "./railFixture";

afterEach(cleanup);

const OPEN_AND_FOLDED = [
  workstream("open", { name: "open ws", order: 0 }),
  agent("o1", "needs-you", "asks", { parent: "open", name: "ask-1" }),
  agent("o2", "needs-you", "asks", { parent: "open", name: "ask-2", order: 1 }),
  agent("o3", "working", "w", { parent: "open", name: "work-1", order: 2 }),
  workstream("shut", { name: "shut ws", order: 1 }),
  agent("s1", "idle", "i", { parent: "shut", name: "idle-1" }),
];

const line = (name: string) => [...rowOf(name).querySelector(".line")!.children];

describe("u403 a Workstream row leads with its chevron", () => {
  it("u403_the_row_leads_with_the_chevron", async () => {
    await mountRail(OPEN_AND_FOLDED);

    for (const name of ["open ws", "shut ws"]) {
      const [first, second] = line(name);

      expect(first!.getAttribute("aria-label"), name).toBe("Collapse");
      expect(first!.tagName).toBe("BUTTON");
      expect(first!.getAttribute("data-button")).toBe("icon");
      expect(second!.classList.contains("name"), name).toBe(true);
    }
  });

  it("u403_no_badge_or_count", async () => {
    await mountRail(OPEN_AND_FOLDED);

    expect(document.querySelector(".badge, .value, [data-group], .group-count, .group-label")).toBeNull();
    expect(screen.getByText("WORKSTREAMS")).toBeTruthy();
    expect(screen.queryByText("workstreams")).toBeNull();
  });

  it("u403_an_open_row_shows_the_ink_count_above_zero", async () => {
    await mountRail([...OPEN_AND_FOLDED, workstream("calm", { name: "calm ws", order: 2 }), agent("c1", "working", "w", { parent: "calm", name: "calm-1" })]);

    expect(rowOf("open ws").querySelector(".ink-count")?.textContent?.trim()).toBe("2");
    expect(rowOf("open ws").querySelector(".ink-count")?.getAttribute("data-tone")).toBe("amber");
    expect(rowOf("calm ws").querySelector(".ink-count")).toBeNull();
    expect(rowOf("calm ws").querySelector(".folded-agents")).toBeNull();
  });

  it("u403_a_folded_row_shows_five_glyphs_then_the_count", async () => {
    const kinds: Kind[] = ["idle", "working", "idle", "blocked", "needs-you", "error", "idle"];

    await mountRail([workstream("big", { name: "big ws" }), ...kinds.map((kind, order) => agent(`a${order}`, kind, "x", { parent: "big", name: `agent-${order}`, order }))]);
    fireEvent.click(rowOf("big ws").querySelector('button[aria-label="Collapse"]')!);

    const folded = rowOf("big ws").querySelector(".folded-agents")!;
    const glyphs = [...folded.querySelectorAll(".glyph")].map((glyph) => glyph.getAttribute("aria-label"));

    expect(glyphs).toHaveLength(5);
    expect(glyphs.slice(0, 2)).toEqual(["Error", "Needs-you"]);
    expect(folded.querySelector(".light")?.textContent).toBe("7");
  });

  it("u403_the_chevron_folds_and_selects_nothing", async () => {
    const { rail } = await mountRail(OPEN_AND_FOLDED);
    const before = rail.selected();

    fireEvent.click(rowOf("open ws").querySelector('button[aria-label="Collapse"]')!);

    await settled();

    expect(itemOf("open ws").getAttribute("aria-expanded")).toBe("false");
    expect(rail.selected()).toBe(before);
    expect(screen.queryByText("ask-1")).toBeNull();
  });
});
