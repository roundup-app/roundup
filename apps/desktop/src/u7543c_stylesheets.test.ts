import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const css = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

it("u7543c_no_scroll_host_stylesheet_overrides_position_for_the_bars", () => {
  for (const path of ["changes/styles.css", "settings/styles.css", "todos/drawer.styles.css", "ui/reading.styles.css"]) {
    // A rule that makes a host scroll and also sets `position: relative` is the override the library's own sheet once needed.
    for (const [, selector = "", body = ""] of css(path).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const scrolls = /overflow(-x|-y)?\s*:\s*(auto|scroll)/.test(body);

      expect(scrolls && /(^|;|\s)position\s*:\s*relative/.test(body), `${path}: ${selector.trim()}`).toBe(false);
    }
  }
});
