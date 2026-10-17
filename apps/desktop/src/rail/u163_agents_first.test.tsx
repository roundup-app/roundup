import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { mountRail } from "./railFixture";

afterEach(cleanup);

const wireframes = readFileSync(join(process.cwd(), "../../docs/wireframes.md"), "utf8");

describe("u163 Agents come before Terminals", () => {
  it("u163_the_row_icons_list_only_agent_for_an_add", async () => {
    const mounted = await mountRail([workstream("g")]);
    mounted.rail.select("g");

    await waitFor(() => expect([...document.querySelectorAll(".row-icons button")].map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual(["Add Agent", "Start supervisor", "Clear Workstream…", "Open folder", "Open in editor"]));
  });

  it("u163_on_an_empty_project_the_first_tab_stop_in_the_rail_is_new_workstream", async () => {
    await mountRail([]);

    const stops = [...document.querySelectorAll<HTMLElement>(".rail-tree button, .rail-tree [tabindex='0'], .rail-actions button")];

    expect(stops[0]?.textContent?.trim()).toBe("Workstream");
    expect(screen.queryByText("terminal", { selector: "button" })).toBeNull();
  });

  it("u163_a_document_names_agent_before_terminal_in_every_add_line", () => {
    const lines = wireframes.split("\n").filter((line) => line.includes("+ terminal"));

    expect(lines).toEqual([]);
    expect(wireframes).toContain("its group ends with an icon button");
  });
});
