import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { mountRail, rowOf } from "./railFixture";
import { workstream } from "../testing/nodes";

afterEach(cleanup);

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("u387 focus inside a row shows its row action", () => {
  it("u387_focus_on_collapse_shows_start_door", async () => {
    await mountRail([workstream("g")]);
    const collapse = rowOf("g").querySelector<HTMLElement>("button[aria-label=Collapse]")!;

    fireEvent.focusIn(collapse);

    expect(screen.getByRole("button", { name: "Start Door" })).toBeTruthy();
  });

  it("u387_the_row_does_not_resize", async () => {
    await mountRail([workstream("g")]);
    const row = rowOf("g");
    const collapse = row.querySelector<HTMLElement>("button[aria-label=Collapse]")!;
    const before = row.className;

    fireEvent.focusIn(collapse);

    // jsdom has no layout; the Chromium proof measures the box. Here the row keeps its element and class.
    expect(rowOf("g")).toBe(row);
    expect(row.className).toBe(before);
  });

  it("u387_focus_leaving_hides_the_action", async () => {
    await mountRail([workstream("g")]);
    const collapse = rowOf("g").querySelector<HTMLElement>("button[aria-label=Collapse]")!;

    fireEvent.focusIn(collapse);
    fireEvent.focusOut(collapse, { relatedTarget: document.body });

    expect(screen.queryByRole("button", { name: "Start Door" })).toBeNull();
  });

  it("u387_one_near_predicate", () => {
    for (const path of ["../rail/RailRow.tsx", "../header/ProjectTab.tsx"]) {
      expect(source(path)).toContain('from "../ink/near"');
    }
  });
});
