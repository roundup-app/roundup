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

describe("u417 the Thread's composer", () => {
  it("u417_the_first_line_and_send_share_one_centre_line", async () => {
    await mountThread([door("workstream", "idle", "idle")]);

    // The first line is var(--space-5) tall and send is var(--space-5) tall; both start at the row's top.
    expect(rule(".thread-composer textarea")).toMatch(/line-height:\s*var\(--space-5\)/);
    expect(rule(".thread-send")).toMatch(/align-self:\s*flex-start/);
    expect(sheet).toMatch(/min-height:\s*var\(--space-5\)/);
  });

  it("u417_the_composer_rests_two_lines_tall_with_even_padding", async () => {
    await mountThread([door("workstream", "idle", "idle")]);

    expect(rule(".thread-composer")).toMatch(/padding:\s*var\(--space-3\);/);
    expect(rule(".thread-composer textarea")).toMatch(/min-height:\s*calc\(var\(--space-5\) \* 2\)/);
    expect(rule(".thread-composer textarea")).toMatch(/padding:\s*0;/);
  });

  it("u417_the_input_and_its_hint_use_the_interface_font", async () => {
    await mountThread([door("workstream", "idle", "idle")]);

    expect(rule(".thread-composer textarea")).toMatch(/font-family:\s*var\(--font-ui\)/);
    expect(rule(".thread-composer textarea")).not.toMatch(/--mono/);
  });

  it("u417_the_input_still_grows_to_five_lines", async () => {
    await mountThread([door("workstream", "idle", "idle")]);

    expect(rule(".thread-composer textarea")).toMatch(/max-height:\s*calc\(var\(--space-6\) \* 5\)/);
    expect(rule(".thread-composer textarea")).toMatch(/overflow-y:\s*auto/);
  });
});
