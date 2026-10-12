import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, railCallsTo } from "./railFixture";

afterEach(cleanup);

const add = () => screen.findByLabelText("add agent");

describe("u392 the Agent add is an icon button", () => {
  it("u392_the_inside_line_is_one_icon_button_named_add_agent", async () => {
    const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" })]);
    mounted.rail.select("a");
    await add();

    const buttons = [...document.querySelectorAll<HTMLElement>(".rail-adds button[data-button='icon']")];

    expect(buttons.map((button) => [button.dataset.button, button.getAttribute("aria-label"), button.title, button.textContent?.trim()])).toEqual([["icon", "add agent", "add agent ⌘N", ""]]);
  });

  it("u392_the_icon_add_spawns_with_the_workstream_as_parent", async () => {
    const mounted = await mountRail([workstream("g"), agent("a", "idle", "i", { parent: "g" })]);
    mounted.app.handlers["agent.spawn"] = () => agent("fresh", "idle", "starting");
    mounted.rail.select("a");

    fireEvent.click(await add());
    await waitFor(() => expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([{ cwd: "/p", prompt: null, parent: "g" }]));
  });

  it("u392_the_icon_add_focuses_an_open_composing_field", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.rail.select("g");
    fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });
    const field = await screen.findByLabelText("prompt");

    fireEvent.click(await add());

    expect(document.activeElement).toBe(field);
    expect(railCallsTo(mounted.app, "agent.spawn")).toEqual([]);
  });

  it("u392_the_icon_add_is_a_keyboard_reachable_button_of_the_icon_kind", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.rail.select("g");
    const button = await add();

    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("data-button")).toBe("icon");
  });

  it("u392_no_button_in_the_rail_names_a_terminal", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.rail.select("g");
    await add();

    const names = [...document.querySelectorAll(".rail button")].map((button) => `${button.textContent} ${button.getAttribute("aria-label") ?? ""}`.toLowerCase());

    expect(names.filter((name) => name.includes("terminal"))).toEqual([]);
  });
});
