import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, door, workstream } from "../testing/nodes";
import { adjacentId } from "./keys";
import styles from "./styles.css?inline";
import { exitedTerminal, mountRail, rowOf, rowNames } from "./railFixture";

afterEach(cleanup);

const icons = (name: string): HTMLButtonElement[] => [...rowOf(name).querySelectorAll<HTMLButtonElement>(".rail-icons button")];

const labels = (name: string): string[] => icons(name).map((button) => button.getAttribute("aria-label") ?? "");

const group = (name: string): HTMLElement | null => rowOf(name).querySelector<HTMLElement>(".rail-icons");

describe("u426 a Rail row carries its icons", () => {
  it("u426_only_workstream_and_agent_rows_carry_icons", async () => {
    await mountRail([workstream("g"), agent("a", "working", "busy", { parent: "g" }), door("d", "idle", "idle")]);

    expect([labels("g"), labels("a"), labels("d")]).toEqual([
      ["Add Agent", "Clear", "Open folder", "Open in editor"],
      ["Stop", "Open folder", "Open in editor"],
      ["Add Agent", "Clear", "Open folder", "Open in editor"],
    ]);
    expect(document.querySelectorAll(".rail-icons")).toHaveLength(3);
    expect(document.querySelector(".pad-leaf .rail-icons, .tab .rail-icons")).toBeNull();
  });

  it("u426_the_group_shows_on_hover_focus_and_selection", async () => {
    await mountRail([workstream("g"), agent("a", "working", "busy", { parent: "g" })]);

    expect(group("a")?.dataset["shown"]).toBe("false");

    fireEvent.mouseEnter(rowOf("a"));
    expect(group("a")?.dataset["shown"]).toBe("true");
    fireEvent.mouseLeave(rowOf("a"));
    expect(group("a")?.dataset["shown"]).toBe("false");

    fireEvent.focusIn(icons("a")[0]!);
    expect(group("a")?.dataset["shown"]).toBe("true");
    fireEvent.focusOut(icons("a")[0]!, { relatedTarget: document.body });
    expect(group("a")?.dataset["shown"]).toBe("false");

    fireEvent.click(rowOf("a"));
    expect(group("a")?.dataset["shown"]).toBe("true");
    expect(group("g")?.dataset["shown"]).toBe("false");
  });

  it("u426_every_icon_is_an_icon_button_with_label_and_title", async () => {
    await mountRail([workstream("g"), agent("a", "working", "busy", { parent: "g" })]);

    for (const button of [...icons("g"), ...icons("a")]) {
      expect(button.tagName).toBe("BUTTON");
      expect(button.dataset["button"]).toBe("icon");
      expect(button.getAttribute("aria-label")).toBeTruthy();
      expect(button.title).toContain(button.getAttribute("aria-label"));
      expect(button.querySelectorAll("svg.icon")).toHaveLength(1);
      expect(button.textContent?.trim()).toBe("");
    }
  });

  it("u426_showing_the_icons_moves_no_row", async () => {
    const sheet = document.head.appendChild(document.createElement("style"));
    sheet.textContent = styles;
    await mountRail([workstream("g"), agent("a", "working", "busy", { parent: "g" })]);

    const hidden = getComputedStyle(group("a")!);
    const before = [hidden.position, hidden.opacity, hidden.pointerEvents];
    fireEvent.mouseEnter(rowOf("a"));
    const shown = getComputedStyle(group("a")!);
    const after = [shown.position, shown.opacity];
    const line = getComputedStyle(rowOf("a").querySelector(".line")!);
    sheet.remove();

    // Hidden or shown, the group is out of the flow, so the row keeps its one line and its height.
    expect(before).toEqual(["absolute", "0", "none"]);
    expect(after).toEqual(["absolute", "1"]);
    expect([line.display, line.whiteSpace]).toEqual(["flex", "pre"]);
    expect(rowOf("a").querySelectorAll("p")).toHaveLength(1);
  });

  it("u426_a_long_name_never_wraps_beside_the_icons", async () => {
    const sheet = document.head.appendChild(document.createElement("style"));
    sheet.textContent = styles;
    await mountRail([agent("long", "working", "busy", { name: "a".repeat(60) })]);

    const name = getComputedStyle(rowOf("a".repeat(60)).querySelector(".name")!);
    const icon = getComputedStyle(group("a".repeat(60))!);
    sheet.remove();

    // The name ellipsizes in its own line and the icons take no width from it, since they sit out of the flow.
    expect([name.overflow, name.textOverflow, name.flexShrink, name.minWidth]).toEqual(["hidden", "ellipsis", "1", "0px"]);
    expect(icon.position).toBe("absolute");
  });

  it("u426_railstep_skips_icons", async () => {
    const mounted = await mountRail([workstream("g"), agent("a", "working", "busy", { parent: "g" }), workstream("h")]);
    mounted.rail.select("g");
    const row = rowOf("g");

    row.focus();
    fireEvent.keyDown(row, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("data-id")).toBe("a");

    // Arrow keys pressed on an icon are not the Rail's.
    fireEvent.keyDown(icons("a")[0]!, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("data-id")).toBe("a");
    expect(rowNames()).toEqual(["g", "a", "h"]);
    expect(adjacentId(["g", "a", "h"], "a", 1)).toBe("h");
  });

  it("u426_an_icon_runs_without_selecting_its_row", async () => {
    const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" })]);
    mounted.rail.select("g");

    fireEvent.click(screen.getAllByLabelText("Open folder")[1]!);

    await waitFor(() => expect(mounted.app.openedTargets).toHaveLength(1));
    expect(mounted.rail.selected()).toBe("g");
  });

  it("u426_the_row_menu_keeps_stop_resume_and_remove", async () => {
    await mountRail([agent("a", "idle", "i"), agent("b", "done", "done", { can_resume: true })], [exitedTerminal("b", 0)]);

    fireEvent.contextMenu(rowOf("a"), { clientX: 1, clientY: 1 });
    expect(screen.getAllByRole("menuitem").map((each) => each.textContent)).toEqual(["Stop", "Model…", "Remove"]);
    fireEvent.contextMenu(rowOf("b"), { clientX: 1, clientY: 1 });
    expect(screen.getAllByRole("menuitem").map((each) => each.textContent)).toEqual(["Resume", "Model…", "Remove"]);
  });
});
