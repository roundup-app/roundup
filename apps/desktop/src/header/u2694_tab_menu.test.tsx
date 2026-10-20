import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agent } from "../testing/nodes";
import { openTabs, path, tab } from "./stripFixture";

// jsdom has no layout; Ark excludes zero-size controls from its focus targets.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(20);
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1024);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(768);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const open = (name: string) => fireEvent.contextMenu(tab(name), { clientX: 40, clientY: 10 });

describe("u2694 the Project tab's system menu", () => {
  it("u2694a_each_object_builds_its_items", async () => {
    const { app } = await openTabs({ api: [], web: [] });

    open("api");

    expect(app.menuLabels()).toEqual(["Rename", "Close"]);
    expect(app.shownMenus.at(-1)!.items[0]).toMatchObject({ shortcut: "F2" });
  });

  it("u2694b_rename_starts_the_in_place_edit_of_each_object_tab", async () => {
    const { app } = await openTabs({ api: [], web: [] });

    open("api");
    await app.pickMenu("Rename");

    expect((await screen.findByRole<HTMLInputElement>("textbox", { name: "Project name" })).value).toBe("api");
  });

  it("u2694b_close_asks_as_u184_asks", async () => {
    const { app } = await openTabs({ api: [agent("a", "working", "x")], web: [] });

    open("api");
    await app.pickMenu("Close");

    expect((await screen.findByRole("alertdialog")).textContent).toContain("Close api?");
    expect(app.closed).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(app.closed).toEqual([]);

    open("web");
    await app.pickMenu("Close");

    await waitFor(() => expect(app.closed).toEqual([path("web")]));
  });
});
