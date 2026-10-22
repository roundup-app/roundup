import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const css = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");

const block = (sheet: string, selector: string) =>
  sheet.match(new RegExp(`${selector.replace(/[.#]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

it("u3785_window_and_scroll_areas_hold_their_overscroll", () => {
  const window = block(css("styles.css"), "html,\nbody,\n#root");
  expect(window).toMatch(/overflow:\s*hidden/);
  expect(window).toMatch(/overscroll-behavior:\s*none/);

  expect(block(css("terminal/styles.css"), ".xterm .xterm-viewport")).toMatch(/overscroll-behavior:\s*contain/);
});
