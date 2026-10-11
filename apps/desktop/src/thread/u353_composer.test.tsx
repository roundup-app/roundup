import { cleanup } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { door } from "../testing/nodes";
import { mountThread } from "./threadFixture";

const [sheet = ""] = Object.values(import.meta.glob<string>("./styles.css", { query: "?raw", import: "default", eager: true }));

const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return [...sheet.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*{([^}]*)}`, "g"))].map((match) => match[1]).join("\n");
};

afterEach(cleanup);

describe("u353 the Thread's composer", () => {
  it("u353_focus_is_one_accent_bar_and_no_outline", async () => {
    await mountThread([door("workstream", "idle", "idle")]);

    const focused = rule(".thread-composer:has(textarea:focus-visible)");

    expect(focused).toMatch(/background-image:\s*linear-gradient\(var\(--accent\), var\(--accent\)\)[^}]*background-size:\s*100% calc\(var\(--space-1\) \/ 2\)/);
    expect(focused).not.toMatch(/outline-(width|style|offset)/);
    expect(rule(".thread-composer")).not.toMatch(/border:\s*[1-9]|outline/);
  });

  it("u353_the_input_draws_no_hover_or_pressed_colour_and_shows_a_text_cursor", async () => {
    await mountThread([door("workstream", "idle", "idle")]);

    const field = rule(".thread-composer textarea");

    expect(field).toMatch(/background-color:\s*transparent/);
    expect(field).toMatch(/cursor:\s*text/);
    expect(sheet).not.toMatch(/\.thread-composer textarea:(hover|active)/);
  });

  it("u353_the_gap_below_the_composer_equals_the_gap_at_its_sides", async () => {
    await mountThread([door("workstream", "idle", "idle")]);

    expect(rule(".thread-composer")).not.toMatch(/margin/);
    expect(rule(".thread")).toMatch(/padding-bottom:\s*var\(--space-4\)/);
  });
});
