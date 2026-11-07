import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { tab, openTabs } from "../header/stripFixture";
import { leaderKey } from "../keys/leaderFixture";
import { node, workstream } from "../testing/nodes";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

const trees = () => ({ a: [node("root", { order: 0 }), workstream("w", { opening_prompt: "Work", order: 1 })], b: [node("root", { order: 0 }), workstream("w", { opening_prompt: "Work", order: 1 })] });

const layout = () => ({
  vars: ["--rail-width", "--shelf-span"].map(name => document.querySelector<HTMLElement>(`[style*="${name}"]`)?.style.getPropertyValue(name)),
  shelfHidden: document.querySelector<HTMLElement>(".shelf")?.hidden,
  heads: [...document.querySelectorAll(".rail-tree .section-head")].map(head => head.getAttribute("aria-expanded")),
});

it("u389_viewer_state_is_the_same_in_every_project", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 1280, height: 800, right: 1280, bottom: 800, toJSON() {} });
  await openTabs(trees());
  fireEvent.click(tab("a"));
  await waitFor(() => expect(document.querySelector('[aria-label="Ask"]')).not.toBeNull());
  leaderKey("KeyB");
  await waitFor(() => expect(document.querySelector<HTMLElement>(".shelf")!.hidden).toBe(false));

  for (const [name, key] of [["Resize Rail", "End"], ["Resize Bench", "Home"]] as const) {
    const edge = await screen.findByRole("separator", { name });

    edge.focus();
    fireEvent.keyDown(edge, { key });
    await waitFor(() => expect(layout().vars).not.toEqual(["288px", "320px"]));
  }

  fireEvent.click(document.querySelector<HTMLElement>(".rail-tree .section-head")!);
  leaderKey("KeyB");
  await waitFor(() => expect(document.querySelector<HTMLElement>(".shelf")!.hidden).toBe(true));

  const inA = layout();

  expect(inA.vars).not.toContain("288px");
  expect(inA.vars).not.toContain("320px");
  expect(inA.heads).toContain("false");

  // Every change made in A has landed before the switch is watched.
  await waitFor(() => {
    const stored = JSON.parse(localStorage.getItem("roundup:viewer") ?? "{}");

    expect([stored.rail, stored.frame?.open, stored.sections?.length]).toEqual([480, false, 1]);
    expect(stored.shelf).not.toBe(320);
  });

  const writes = vi.spyOn(Storage.prototype, "setItem");

  fireEvent.click(tab("b"));
  await waitFor(() => expect(tab("b").getAttribute("aria-selected")).toBe("true"));
  expect(layout()).toEqual(inA);
  fireEvent.click(tab("a"));
  await waitFor(() => expect(tab("a").getAttribute("aria-selected")).toBe("true"));
  expect(layout()).toEqual(inA);
  // The switch itself keeps its own record (the selected Project tab); none of the layout families is written.
  expect(writes.mock.calls.map(([key]) => key).filter(key => /^roundup:(viewer|widths|shelf|app-settings)/.test(key))).toEqual([]);
});
