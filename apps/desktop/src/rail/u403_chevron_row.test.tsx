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

const line = (name: string) => [...rowOf(name).querySelector(".line")!.children].filter((child) => !child.classList.contains("glyph"));

describe("u403 a Workstream row leads with its chevron", () => {








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
