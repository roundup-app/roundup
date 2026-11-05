import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agent } from "../testing/nodes";
import { openTabs, tab } from "./stripFixture";

// jsdom has no layout; Ark excludes zero-size controls from its focus targets.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(20);
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1024);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(768);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const open = (name: string) => fireEvent.contextMenu(tab(name), { clientX: 40, clientY: 10 });

const checked = (app: Awaited<ReturnType<typeof openTabs>>["app"]) => app.shownMenus.at(-1)!.items.find(item => item.id === "alerts")!.children!.filter(item => item.checked).map(item => item.label);

describe("u6220d right-click a Project tab to set its alert level", () => {
  it("u6220d_the_menu_offers_three_levels_with_all_checked_at_first", async () => {
    const { app } = await openTabs({ api: [], web: [] });

    open("api");

    expect(app.shownMenus.at(-1)!.items.find(item => item.id === "alerts")!.children!.map(item => item.label)).toEqual(["All", "Needs you only", "Off"]);
    expect(checked(app)).toEqual(["All"]);
  });

  it("u6220d_a_choice_applies_to_that_project_only_and_survives_a_reload", async () => {
    const { app } = await openTabs({ api: [], web: [] });

    open("api");
    await app.pickMenu("Off");
    open("api");
    expect(checked(app)).toEqual(["Off"]);
    open("web");
    expect(checked(app)).toEqual(["All"]);
    await app.closeMenu();

    cleanup();
    const reloaded = await openTabs({ api: [], web: [] }, true);

    open("api");
    expect(checked(reloaded.app)).toEqual(["Off"]);
    open("web");
    expect(checked(reloaded.app)).toEqual(["All"]);
  });

  it("u6220d_the_dock_badge_drops_an_off_project_and_keeps_a_needs_you_only_one", async () => {
    const { app } = await openTabs({ api: [agent("a", "needs-you", "x"), agent("b", "working", "x")], web: [agent("c", "error", "x")] });

    await waitFor(() => expect(app.badges.at(-1)).toBe(2));

    open("api");
    await app.pickMenu("Off");
    await waitFor(() => expect(app.badges.at(-1)).toBe(1));

    open("api");
    await app.pickMenu("Needs you only");
    await waitFor(() => expect(app.badges.at(-1)).toBe(2));
  });

  it("u6220d_the_tab_keeps_its_attention_mark_at_every_level", async () => {
    const { app } = await openTabs({ api: [agent("a", "needs-you", "x")], web: [] });

    open("api");
    await app.pickMenu("Off");

    expect(tab("api").querySelector(".tab-mark")?.getAttribute("data-kind")).toBe("needs-you");
  });
});
