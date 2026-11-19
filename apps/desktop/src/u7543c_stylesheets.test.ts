import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const css = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");

it("u7543c_no_scroll_host_stylesheet_overrides_position_for_the_bars", () => {
  for (const path of ["changes/styles.css", "settings/styles.css", "todos/drawer.styles.css", "ui/reading.styles.css"]) {
    expect(css(path), path).not.toMatch(/scrollbar host|OverlayScrollbars gives/i);
  }
});
