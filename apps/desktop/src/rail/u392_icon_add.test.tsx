import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { RpcError } from "../app/seam";
import { agent, event, workstream } from "../testing/nodes";
import { mountRail, railCallsTo } from "./railFixture";

afterEach(cleanup);

const add = () => screen.findByLabelText("Add Agent");

describe("u392 the Agent add is an icon button", () => {
  it("u392_the_add_is_one_icon_button_named_add_agent_on_the_workstream_row", async () => {
    const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" })]);
    mounted.rail.select("a");
    await add();

    const buttons = [...document.querySelectorAll<HTMLElement>("[aria-label='Add Agent']")];

    expect(buttons.map((button) => [button.dataset.button, button.getAttribute("aria-label"), button.textContent?.trim(), button.closest("[role=treeitem]")?.getAttribute("data-id")])).toEqual([["quiet", "Add Agent", "Agent", "g"]]);

  });

  it("u392_the_icon_add_spawns_with_the_workstream_as_parent", async () => {
    const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" })]);
    mounted.app.handlers["agent.spawn"] = () => agent("fresh", "idle", "starting");
    mounted.rail.select("a");

    fireEvent.click(await add());
    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: "g", model: null, effort: null }]));
  });

  it("u392_the_icon_add_is_a_keyboard_reachable_button_of_the_icon_kind", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.rail.select("g");
    const button = await add();

    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("data-button")).toBe("quiet");
  });

  it("u392_no_button_in_the_rail_names_a_terminal", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.rail.select("g");
    await add();

    const names = [...document.querySelectorAll(".rail button")].map((button) => `${button.textContent} ${button.getAttribute("aria-label") ?? ""}`.toLowerCase());

    expect(names.filter((name) => name.includes("terminal"))).toEqual([]);
  });

  it("u392_a_failed_icon_add_shows_one_ink_line", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.app.handlers["agent.spawn"] = () => {
      throw new RpcError(-32000, "no claude on PATH");
    };

    mounted.rail.select("g");

    fireEvent.click(await add());
    const shown = await screen.findByText("no claude on PATH");

    expect(shown.className).toBe("ink");
  });

  it("u392_the_icon_add_selects_its_new_row_once_the_tree_has_it", async () => {
    const tree: RailNode[] = [workstream("g")];
    const mounted = await mountRail(tree);
    const spawned = agent("fresh", "idle", "starting", { parent: "g" });
    mounted.app.handlers["agent.spawn"] = () => {
      tree.push(spawned);
      mounted.app.emit(event({ name: "rail.changed" }));

      return spawned;
    };

    mounted.rail.select("g");

    fireEvent.click(await add());

    await waitFor(() => expect(mounted.rail.selected()).toBe("fresh"));
  });
});
