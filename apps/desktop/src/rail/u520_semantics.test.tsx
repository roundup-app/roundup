import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { runAxe } from "../testing/axe";
import { agent, door, workstream } from "../testing/nodes";
import { itemOf, mountRail, rowOf, settled } from "./railFixture";

afterEach(cleanup);

const tree = () => [
  workstream("outer"),
  workstream("inner", { parent: "outer" }),
  agent("leaf", "idle", "x", { parent: "inner" }),
  door("door", "working", "y", { order: 1 }),
  agent("child", "idle", "z", { parent: "door" }),
];

describe("u520 the Rail's accessibility tree", () => {
  it("u520_tree_semantics_and_names", async () => {
    await mountRail(tree());

    expect(screen.getAllByRole("tree")).toHaveLength(1);
    expect(screen.getByRole("tree").getAttribute("aria-labelledby")).not.toBeNull();
    expect(screen.getByRole("tree", { name: "Rail" })).toBeTruthy();

    const levels = Object.fromEntries(["outer", "inner", "leaf", "door", "child"].map((name) => [name, itemOf(name).getAttribute("aria-level")]));

    expect(levels).toEqual({ outer: "1", inner: "2", leaf: "3", door: "1", child: "2" });
    // A fold is a branch's own attribute; a leaf carries none.
    expect(["outer", "inner", "door"].map((name) => itemOf(name).getAttribute("aria-expanded"))).toEqual(["true", "true", "true"]);
    expect(["leaf", "child"].map((name) => itemOf(name).hasAttribute("aria-expanded"))).toEqual([false, false]);

    fireEvent.click(within(rowOf("inner")).getByRole("button", { name: "Collapse" }));
    await settled();

    expect(itemOf("inner").getAttribute("aria-expanded")).toBe("false");

    for (const button of document.querySelectorAll<HTMLElement>(".rail-tree button")) {
      expect(button.getAttribute("title") ?? "").toBe("");
      expect((button.getAttribute("aria-label") ?? button.textContent ?? "").trim()).not.toBe("");
    }
  });

  it("u520_axe_clean", async () => {
    await mountRail(tree());

    const { violations } = await runAxe();

    expect(violations).toEqual([]);
  });
});
