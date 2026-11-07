import { createRoot, createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { createWidths, STRIP_WIDTH } from "./widths";

afterEach(() => localStorage.clear());

it("u6228_collapse_is_kept_per_project_and_keeps_the_last_width", async () => {
  const settled = () => vi.waitFor(() => expect(JSON.parse(localStorage.getItem("roundup:viewer") ?? "null")).toMatchObject({ collapsed: true }));

  await createRoot(async (dispose) => {
    const [path, setPath] = createSignal<string | null>("/a");
    const widths = createWidths(path);

    widths.rail.commit(400);
    widths.setCollapsed(true);
    expect(widths.rail.now()).toBe(STRIP_WIDTH);
    await settled();

    setPath("/b");
    expect(widths.collapsed()).toBe(false);
    expect(widths.rail.now()).toBe(288);

    setPath("/a");
    expect(widths.collapsed()).toBe(true);
    widths.setCollapsed(false);
    expect(widths.rail.now()).toBe(400);
    dispose();
  });

});
