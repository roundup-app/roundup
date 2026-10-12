import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dropScale, tauriFileDrop } from "../app/tauri";
import type { FakeApp } from "../testing/fakeApp";
import { agent, door } from "../testing/nodes";
import { mountThread } from "./threadFixture";

const COMPOSER = new DOMRect(300, 600, 600, 100);

const chips = () => [...document.querySelectorAll("[data-attachment-name], .thread-attachment")].map((chip) => chip.textContent ?? "");

const failure = () => document.querySelector("[role=alert]")?.textContent ?? "";

/** jsdom has no layout: the composer, the Thread's ground and the Pane get fixed rectangles. */
const layout = () =>
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.matches(".thread-composer")) return COMPOSER;

    if (this.matches(".thread")) return new DOMRect(300, 100, 600, 600);

    if (this.matches(".shelf")) return new DOMRect(900, 0, 380, 800);

    if (this.matches(".drawer")) return new DOMRect(900, 0, 380, 800);

    if (this.matches(".pane-body")) return new DOMRect(0, 100, 300, 600);

    return new DOMRect(0, 0, 0, 0);
  });

/** Tauri's payload: a drop at physical pixels, as `onDragDropEvent` reports it, through the adapter into the fake App. */
const nativeDrop = async (app: FakeApp, ratio: number, x: number, y: number, paths: string[]) => {
  let deliver: (event: { payload: unknown }) => void = () => {};

  const webview = {
    onDragDropEvent: async (handler: typeof deliver) => {
      deliver = handler;

      return () => {};
    },
  };

  // SAFETY: the stub implements the one method the adapter calls.
  await tauriFileDrop(() => webview as never, () => ratio)((drop) => app.dropFiles(drop));
  deliver({ payload: { type: "drop", paths, position: { x: x * ratio, y: y * ratio } } });
};

describe("u415 a drop on the composer", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  for (const ratio of [1, 2, 3]) {
    it(`u415_a_real_scale_drop_on_the_composer_attaches_the_image (ratio ${ratio})`, async () => {
      const { app } = await mountThread([door("workstream", "idle", "idle")]);

      layout();
      await waitFor(() => expect(app.dropFiles).toBeDefined());
      await nativeDrop(app, ratio, 600, 650, ["/Users/me/Desktop/Shot.png"]);

      expect(chips().join()).toContain("Shot.png");
      expect(failure()).toBe("");
    });
  }

  it("u415_macos_reports_the_drop_point_in_css_pixels_so_it_is_not_divided", async () => {
    expect([1, 2, 3].map((ratio) => dropScale("MacIntel", ratio))).toEqual([1, 1, 1]);
    expect([1, 2, 3].map((ratio) => dropScale("Win32", ratio))).toEqual([1, 2, 3]);

    const { app } = await mountThread([door("workstream", "idle", "idle")]);

    layout();
    await waitFor(() => expect(app.dropFiles).toBeDefined());
    await nativeDrop(app, dropScale("MacIntel", 2), 600, 650, ["/Users/me/Desktop/Shot.png"]);

    expect(chips().join()).toContain("Shot.png");
  });

  it("u415_an_unplaced_drop_says_so_in_the_failure_line", async () => {
    const { app } = await mountThread([door("workstream", "idle", "idle")]);

    layout();
    app.dropFiles({ phase: "drop", paths: ["/p/Shot.png"], x: 600, y: 300 });

    expect(chips()).toEqual([]);
    expect(failure()).toBe("couldn't place the drop");
  });

  it("u415_a_drop_on_the_shelf_says_so", async () => {
    const { app } = await mountThread([door("workstream", "idle", "idle")]);

    layout();
    app.dropFiles({ phase: "drop", paths: ["/p/Shot.png"], x: 1000, y: 300 });

    expect(chips()).toEqual([]);
    expect(failure()).toBe("couldn't place the drop");
  });

  it("u415_a_drop_on_the_header_or_the_rail_below_its_rows_says_so", async () => {
    const { app } = await mountThread([door("workstream", "idle", "idle")]);

    layout();
    app.dropFiles({ phase: "drop", paths: ["/p/Shot.png"], x: 600, y: 20 });
    expect(failure()).toBe("couldn't place the drop");

    cleanup();

    const next = await mountThread([door("workstream", "idle", "idle")]);

    layout();
    next.app.dropFiles({ phase: "drop", paths: ["/p/Shot.png"], x: 100, y: 780 });
    expect(failure()).toBe("couldn't place the drop");
  });

  it("u415_a_drop_on_the_pane_in_a_takeover_shows_no_line", async () => {
    const { app } = await mountThread([door("workstream", "idle", "idle")]);

    layout();
    fireEvent.click(document.querySelector<HTMLButtonElement>("button[aria-label=More]")!);
    fireEvent.click([...document.querySelectorAll("[role=menuitem]")].find((item) => /take over/i.test(item.textContent ?? ""))!);
    await waitFor(() => expect(document.querySelector(".pane-takeover")).not.toBeNull());
    app.dropFiles({ phase: "drop", paths: ["/p/Shot.png"], x: 100, y: 300 });

    expect(failure()).toBe("");
  });

  it("u415_a_drop_on_the_pane_of_an_agent_below_the_door_shows_no_line", async () => {
    const { app, connected } = await mountThread([door("workstream", "idle", "idle"), agent("a", "idle", "idle", { parent: "workstream" })]);

    layout();
    connected.rail.select("a");
    await waitFor(() => expect(document.querySelector(".thread")?.getAttribute("data-mode")).toBe("agent"));
    app.dropFiles({ phase: "drop", paths: ["/p/Shot.png"], x: 100, y: 300 });

    expect(failure()).toBe("");
  });
});
