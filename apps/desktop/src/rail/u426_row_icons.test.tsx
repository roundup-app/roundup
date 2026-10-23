import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, door, workstream } from "../testing/nodes";
import { exitedTerminal, mountRail, rowOf, settled } from "./railFixture";

afterEach(cleanup);

const iconsOf = (name: string) => [...rowOf(name).querySelectorAll<HTMLElement>(".row-icons button")];

const labelsOf = (name: string) => iconsOf(name).map((button) => button.getAttribute("aria-label"));

describe("u426 a Rail row shows its icons", () => {
  it("u426_only_workstream_and_agent_rows_carry_icons", async () => {
    await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" }), door("d", "idle", "i")]);

    expect([...document.querySelectorAll("[role=treeitem][data-id]")].map((row) => [row.getAttribute("data-id"), row.querySelectorAll(".row-icons").length])).toEqual([["g", 1], ["a", 1], ["d", 1]]);
    expect(document.querySelectorAll(".rail-fold .row-icons, .group-head .row-icons")).toHaveLength(0);
  });

  it("u426_the_group_shows_on_hover_focus_and_selection", async () => {
    const mounted = await mountRail([workstream("g"), workstream("h")]);
    const row = rowOf("g");

    expect(row.dataset.near).toBe("false");
    fireEvent.mouseEnter(row);
    expect(row.dataset.near).toBe("true");
    fireEvent.mouseLeave(row);
    expect(row.dataset.near).toBe("false");
    fireEvent.focusIn(iconsOf("g")[0]!);
    expect(row.dataset.near).toBe("true");
    fireEvent.focusOut(iconsOf("g")[0]!);
    mounted.rail.select("h");
    expect(rowOf("h").dataset.near).toBe("true");
  });

  it("u426_every_icon_is_an_icon_button_with_label_and_tooltip", async () => {
    await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" })]);
    fireEvent.keyDown(document, { key: "Tab" });

    for (const name of ["g", "a"]) {
      for (const button of iconsOf(name).filter((each) => !each.classList.contains("rail-add"))) {
        expect([button.tagName, button.dataset.button, button.querySelectorAll("svg.icon").length]).toEqual(["BUTTON", "icon", 1]);
        expect(button.getAttribute("aria-label")).toBeTruthy();
        button.focus();
        await waitFor(() => expect(screen.getAllByRole("tooltip").map((tip) => tip.textContent)).toContain(button.getAttribute("aria-label")));
        button.blur();
        await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
      }
    }
  });

  it("u426_arrow_down_skips_icons", async () => {
    await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" })]);
    const row = rowOf("g");

    row.focus();
    fireEvent.keyDown(row, { key: "ArrowDown" });
    await settled();
    expect(document.activeElement).toBe(rowOf("a"));
    expect(iconsOf("g").every((button) => button.tagName === "BUTTON" && button.tabIndex === 0)).toBe(true);
  });

  it("u426_an_icon_runs_without_selecting_its_row", async () => {
    const mounted = await mountRail([workstream("g"), workstream("h")]);
    mounted.rail.select("g");

    fireEvent.click(iconsOf("h").find((button) => button.getAttribute("aria-label") === "Open folder")!);

    expect(mounted.rail.selected()).toBe("g");
  });


  it.each(["idle", "working", "needs-you", "blocked"] as const)("u426_stop_preserves_selection_for_%s", async (kind) => {
    const mounted = await mountRail([workstream("g"), agent("a", kind, "i", { parent: "g" })]);
    mounted.app.handlers["agent.stop"] = () => null;
    mounted.rail.select("g");
    fireEvent.click(iconsOf("a").find((button) => button.getAttribute("aria-label") === "Stop")!);
    expect(mounted.rail.selected()).toBe("g");

    if (kind !== "idle") {
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Stop" }));
      expect(mounted.rail.selected()).toBe("g");
    }
  });

  it("u426_a_stopped_agent_offers_no_stop_icon", async () => {
    await mountRail([door("m", "done", "done")], [exitedTerminal("m", 0)]);

    expect(labelsOf("m")).not.toContain("Stop");
  });
});
