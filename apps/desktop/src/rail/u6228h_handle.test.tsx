import { render } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { WindowBar } from "../header/WindowBar";
import { RailHandle } from "./RailHandle";

it("u6228h_the_handle_is_the_one_toggle_named_for_the_state_open_strip_and_peek", () => {
  const onToggle = vi.fn();

  // A strip and a peek are both the collapsed state, so both read `Expand the Rail`; an open Rail reads `Collapse the Rail`.
  for (const [collapsed, name, expanded] of [[false, "Collapse the Rail", "true"], [true, "Expand the Rail", "false"]] as const) {
    const { container, unmount } = render(() => <RailHandle collapsed={collapsed} peek={collapsed} slide={undefined} dragging={false} onToggle={onToggle} />);
    const handles = container.querySelectorAll<HTMLButtonElement>('button[aria-label$="the Rail"]');

    expect(handles).toHaveLength(1);
    expect(handles[0]?.getAttribute("aria-label")).toBe(name);
    expect(handles[0]?.getAttribute("aria-expanded")).toBe(expanded);
    handles[0]?.click();
    unmount();
  }

  expect(onToggle).toHaveBeenCalledTimes(2);

  const bar = render(() => (
    <WindowBar app={{ setWindowTitle: vi.fn(async () => {}), dragWindow: vi.fn(async () => {}), zoomWindow: vi.fn(async () => {}) }} project="roundup" rail={undefined} onFailure={() => {}}><div /></WindowBar>
  ));

  expect(bar.container.querySelector('button[aria-label$="the Rail"]')).toBeNull();
});
