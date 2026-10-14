import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { mountRail, pinnedAdd, rowOf } from "../rail/railFixture";

import { ChooseProject, EmptyRail, EmptyShelf } from "./FirstRun";
import { Layout } from "./Layout";
import { Reopen } from "./Reopen";

afterEach(cleanup);

describe("u471 every word the App writes is in sentence case", () => {
  it("u471_previous_copy_assertions_are_preserved_a_workstream_named_workstream_stays_lower_case", async () => {
    await mountRail([workstream("workstream")]);

    expect(rowOf("workstream").textContent).toContain("workstream");
  });

  it("u471_previous_copy_assertions_are_preserved_the_rail_add_reads_plus_workstream", async () => {
    await mountRail([]);

    expect([pinnedAdd().textContent?.trim(), pinnedAdd().getAttribute("aria-label")]).toEqual(["Workstream", "Add Workstream"]);
  });
});


describe("u471 App-owned labels", () => {
  it("u471_previous_copy_assertions_are_preserved_first_run_hints_use_sentence_case_and_glossary_capitals", () => {
    const { container } = render(() => <><EmptyRail /><ChooseProject failure={null} onChoose={() => {}} /><EmptyShelf /></>);
    expect([...container.querySelectorAll("p, button")].map((element) => element.textContent?.trim())).toEqual([
      "Workstreams and Agentsappear here, one per row,nested by indent", "Open a folder to start", "Choose folder…",
      "Todos", "Agents add them as theyplan; so can you", "Pads", "Agent notes", "Yours",
    ]);
  });

  it("u471_previous_copy_assertions_are_preserved_app_regions_keep_glossary_capitals", () => {
    render(() => <Layout header={null} rail={null} centre={null} shelf={null} overlay={null} />);
    expect(screen.getAllByRole("region").map((element) => element.getAttribute("aria-label"))).toEqual(["Rail", "Centre", "Work items"]);
  });

  it("u471_previous_copy_assertions_are_preserved_reopen_uses_sentence_case", () => {
    render(() => <Reopen busy={false} onReopen={() => {}} />);
    expect(screen.getByRole("button", { name: "Reopen" }).textContent?.trim()).toBe("Reopen");
  });

  it("u471_previous_copy_assertions_are_preserved_project_failure_text_stays_as_received", () => {
    render(() => <ChooseProject failure="asks: keep v1 routes?" onChoose={() => {}} />);
    expect(screen.getByText("asks: keep v1 routes?").textContent).toBe("asks: keep v1 routes?");
  });
});
