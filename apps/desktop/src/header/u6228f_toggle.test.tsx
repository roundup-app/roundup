import { render } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { WindowBar } from "./WindowBar";

const bar = (railToggle: { collapsed: boolean; onToggle: () => void } | undefined) => render(() => (
  <WindowBar
    app={{ setWindowTitle: vi.fn(async () => {}), dragWindow: vi.fn(async () => {}), zoomWindow: vi.fn(async () => {}) }}
    project="roundup" rail={undefined} onFailure={() => {}} railToggle={railToggle}
  ><div /></WindowBar>
));

it("u6228f_the_window_bar_holds_one_toggle_named_for_the_state_open_strip_and_peek", () => {
  const onToggle = vi.fn();

  // A strip and a peek are both the collapsed state, so both read `Expand the Rail`; an open Rail reads `Collapse the Rail`.
  for (const [collapsed, name] of [[false, "Collapse the Rail"], [true, "Expand the Rail"]] as const) {
    const { container, unmount } = bar({ collapsed, onToggle });
    const toggles = container.querySelectorAll<HTMLButtonElement>('.window-bar button[aria-label$="the Rail"]');

    expect(toggles).toHaveLength(1);
    expect(toggles[0]!.getAttribute("aria-label")).toBe(name);
    toggles[0]!.click();
    unmount();
  }

  expect(onToggle).toHaveBeenCalledTimes(2);
});
