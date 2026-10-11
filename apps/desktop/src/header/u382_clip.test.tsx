import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { nameParts } from "./tab";
import { openTabs, tab } from "./stripFixture";

afterEach(cleanup);

const names = [2, 3, 4, 5, 6, 7, 8].map((index) => `project-number-${index}`);

describe("u382 a clipped tab keeps what tells it apart", () => {
  it("u382_clipped_twins_differ_on_tabs_8", () => {
    const css = readFileSync(resolve(process.cwd(), "src/header/strip.styles.css"), "utf8");
    const rule = (selector: string) => css.match(new RegExp(`${selector.replace(".", "\\.")} \\{([^}]*)\\}`))?.[1] ?? "";
    const tails = names.map((name) => nameParts(name)[1]);

    expect(new Set(tails).size).toBe(names.length);
    expect(rule(".tab-tail")).toContain("flex: none");
    expect(rule(".tab-head")).toContain("text-overflow: ellipsis");
    expect(rule(".tab-head")).toContain("min-width: 5ch");
  });

  it("u382_a_name_that_fits_is_unchanged", () => {
    expect(nameParts("harness")).toEqual(["harness", ""]);
    expect(nameParts("12345678")).toEqual(["12345678", ""]);
  });

  it("u382_the_accessible_name_is_whole", async () => {
    await openTabs({ "project-number-2": [], harness: [] });

    expect(tab("project-number-2").textContent).toBe("project-number-2");
    expect(tab("project-number-2").querySelector(".tab-tail")?.textContent).toBe("r-2");
  });
});
