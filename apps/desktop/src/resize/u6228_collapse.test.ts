import { createRoot, createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { createWidths, STRIP_WIDTH } from "./widths";

afterEach(() => localStorage.clear());

/** The widths live in a root of their own; a user writes them from outside any owner, as a handler does. */
const mountWidths = (initial: string | null) => createRoot((dispose) => {
  const [path, setPath] = createSignal(initial);

  return { widths: createWidths(path), setPath, dispose };
});

it("u6228_collapse_is_kept_for_every_project_and_keeps_the_last_width", async () => {
  const settled = () => vi.waitFor(() => expect(JSON.parse(localStorage.getItem("roundup:viewer") ?? "null")).toMatchObject({ collapsed: true }));

  const { widths, setPath, dispose } = mountWidths("/a");

  widths.rail.commit(400);
  flush();
  widths.setCollapsed(true);
  flush();
  expect(widths.rail.now()).toBe(STRIP_WIDTH);
  await settled();

  setPath("/b");
  flush();
  expect(widths.collapsed()).toBe(true);
  expect(widths.rail.now()).toBe(STRIP_WIDTH);

  setPath("/a");
  flush();
  expect(widths.collapsed()).toBe(true);
  widths.setCollapsed(false);
  flush();
  expect(widths.rail.now()).toBe(400);
  dispose();
});

it("u6228g_the_column_keeps_its_width_through_a_slide_and_takes_the_strip_once_at_its_end", () => {
  const { widths, dispose } = mountWidths("/a");

  widths.setCollapsed(true, true);
  flush();
  expect(widths.collapsed()).toBe(true);
  expect(widths.rail.now()).toBe(288);

  widths.settleLayout();
  flush();
  expect(widths.rail.now()).toBe(STRIP_WIDTH);

  widths.setCollapsed(false, true);
  flush();
  expect(widths.rail.now()).toBe(STRIP_WIDTH);
  widths.settleLayout();
  flush();
  expect(widths.rail.now()).toBe(288);
  dispose();
});
