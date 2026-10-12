import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { App } from "../App";
import { SEEDS, seedApp } from "../testing/seeds";
import { agent, door, event, terminal, workstream } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import { chord, mountRail, pinnedAdd, railCallsTo, rowNames } from "./railFixture";

afterEach(cleanup);

const inside = (): HTMLElement | null => document.querySelector<HTMLElement>(".rail-adds");

const insideLabels = (): string[] => [...document.querySelectorAll(".rail-adds button")].map((button) => button.getAttribute("aria-label") ?? "");

describe("u162 one add opens a Workstream", () => {
  it("u191_the_pinned_line_holds_one_add_named_new_workstream", async () => {
    await mountRail([workstream("g"), agent("a", "idle", "i")]);

    expect([...document.querySelectorAll(".rail-actions button")].map((button) => button.textContent?.trim())).toEqual(["Workstream"]);
  });

  it("u191_no_agent_terminal_or_room_add_is_outside_a_workstream", async () => {
    await mountRail([workstream("g"), agent("a", "idle", "i"), terminal("t")]);

    const adds = [...document.querySelectorAll("button")].map((button) => button.textContent?.trim());

    expect(adds.filter((label) => /^\+?\s*(agent|terminal|room)$/.test(label ?? ""))).toEqual([]);
    expect(inside()).toBeNull();
  });

  it("u191_new_workstream_creates_selects_and_starts_the_door_once", async () => {
    const tree: RailNode[] = [];
    const mounted = await mountRail(tree);
    mounted.app.handlers["rail.createWorkstream"] = () => door("made", "idle", "idle");
    mounted.app.handlers["rail.startDoor"] = () => door("made", "working", "starting");

    fireEvent.click(pinnedAdd());
    await waitFor(() => expect(railCallsTo(mounted.app, "rail.createWorkstream")).toEqual([{ name: "workstream", parent: null }]));
    tree.push(workstream("made"));
    mounted.app.emit(event({ name: "rail.changed" }));

    await waitFor(() => expect(mounted.rail.selected()).toBe("made"));
    await waitFor(() => expect(railCallsTo(mounted.app, "rail.startDoor")).toEqual([{ id: "made" }]));
  });

  it("u191_the_empty_centre_offers_new_workstream_and_the_rail_only_that", async () => {
    await mountRail([], [], () => null, () => false, { pane: fakeEmulators().factory });

    expect(screen.getByText("no Workstream yet")).toBeTruthy();
    expect(screen.getByText("new Workstream", { selector: ".pane-action" })).toBeTruthy();
    expect([...document.querySelectorAll(".rail-tree button, .rail-actions button")].map((button) => button.textContent?.trim())).toEqual(["Workstream"]);
  });

  it("u191_the_selected_workstream_group_ends_with_plus_agent", async () => {
    const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" }), workstream("h")]);
    mounted.rail.select("a");

    await waitFor(() => expect(insideLabels()).toEqual(["Add Agent", ""]));
    const line = inside()!;

    expect(line.previousElementSibling?.getAttribute("data-id")).toBe("a");
    expect(line.nextElementSibling?.getAttribute("data-id")).toBe("h");
    expect(line.style.getPropertyValue("--indent")).toBe("calc(1 * var(--rail-step) + var(--rail-inset))");
  });

  it("u191_the_inside_adds_spawn_with_that_workstream_as_parent", async () => {
    const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" })]);
    mounted.app.handlers["agent.spawn"] = () => agent("fresh", "idle", "starting");
    mounted.rail.select("a");

    fireEvent.click(await screen.findByLabelText("Add Agent"));
    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: "g" }]));
  });

  it("u191_a_collapsed_or_unselected_workstream_shows_no_adds", async () => {
    const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" }), workstream("h")]);

    expect(inside()).toBeNull();
    mounted.rail.select("g");
    await waitFor(() => expect(document.querySelectorAll(".rail-adds")).toHaveLength(1));
    mounted.rail.select("h");
    await waitFor(() => expect(document.querySelectorAll(".rail-adds")).toHaveLength(1));
    expect(inside()?.previousElementSibling?.getAttribute("data-id")).toBe("h");
    mounted.rail.toggleCollapsed("h");
    await waitFor(() => expect(inside()).toBeNull());
  });

  it("u191_the_adds_are_not_a_rail_row_and_the_arrow_keys_skip_them", async () => {
    const mounted = await mountRail([workstream("g"), workstream("h")]);
    mounted.rail.select("g");
    await screen.findByLabelText("Add Agent");

    expect([rowNames(), inside()?.getAttribute("role"), inside()?.hasAttribute("data-id")]).toEqual([["g", "h"], "none", false]);
    const row = document.querySelector<HTMLElement>('[data-id="g"]')!;

    row.focus();
    fireEvent.keyDown(row, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("data-id")).toBe("h");
  });

  it("u191_cmd_n_keep_their_parent_rule_with_no_workstream", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["agent.spawn"] = () => agent("fresh", "idle", "starting");

    chord("n");
    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: null }]));
  });

  it.each(SEEDS)("u191_no_text_in_the_app_says_room_on_any_seed (%s)", async (seed) => {
    const controls = seedApp(seed, Date.now());

    render(() => <App app={controls.app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    await screen.findByRole("banner");
    await new Promise((done) => setTimeout(done, 50));

    const words = [
      document.body.textContent ?? "",
      ...[...document.querySelectorAll("[title], [aria-label], [placeholder]")].flatMap((element) =>
        ["title", "aria-label", "placeholder"].map((name) => element.getAttribute(name) ?? ""),
      ),
    ].join("\n");

    expect(words.match(/\broom\b/i)).toBeNull();
  });
});
