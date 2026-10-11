import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import row from "./RailRow.tsx?raw";
import todo from "../todos/Todos.tsx?raw";
import tab from "../header/ProjectTab.tsx?raw";
import { exitedTerminal, mountRail, rowOf } from "./railFixture";

afterEach(cleanup);

const mount = () => mountRail([workstream("backend", { terminal_id: "t-backend" })], [exitedTerminal("backend", 1)]);

const action = () => screen.queryByRole("button", { name: "start Door" });

describe("u387 focus inside a row shows its row action", () => {
  it("u387_focus_on_collapse_shows_start_door", async () => {
    await mount();

    rowOf("backend").querySelector<HTMLElement>("[aria-label=collapse]")?.focus();

    expect(rowOf("backend").contains(action())).toBe(true);
  });

  it("u387_focus_leaving_hides_the_action", async () => {
    await mount();
    const collapse = rowOf("backend").querySelector<HTMLElement>("[aria-label=collapse]");

    collapse?.focus();
    collapse?.blur();

    expect(action()).toBeNull();
  });

  it("u387_the_row_does_not_resize", async () => {
    await mount();
    const row = rowOf("backend");
    const before = row.getAttribute("style");

    fireEvent.focusIn(row);

    expect([row.getAttribute("style"), action() !== null]).toEqual([before, true]);
  });

  it("u387_one_near_predicate", () => {
    const uses = [row, todo, tab].map((source) => source.includes('state/near"'));

    expect(uses).toEqual([true, true, true]);
  });
});
