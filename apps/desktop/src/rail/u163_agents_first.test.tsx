import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { mountRail } from "./railFixture";

afterEach(cleanup);

const wireframes = readFileSync(join(process.cwd(), "../../docs/wireframes.md"), "utf8");

describe("u163 Agents come before Terminals", () => {
  

  it("u163_on_an_empty_project_the_first_tab_stop_in_the_rail_is_new_workstream", async () => {
    await mountRail([]);

    const stops = [...document.querySelectorAll<HTMLElement>(".rail-tree button, .rail-tree [tabindex='0'], .rail-actions button")];

    expect(stops[0]?.textContent?.trim()).toBe("Workstream");
    expect(screen.queryByText("terminal", { selector: "button" })).toBeNull();
  });

  
});
