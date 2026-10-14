import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { agent, workstream } from "../../testing/nodes";
import { LIST } from "../../models/modelsFixture";
import { mountRail, rowOf } from "../railFixture";

afterEach(cleanup);

describe("u471 Rail menu sentence case", () => {
  it("u471_previous_copy_assertions_are_preserved_rail_model_actions_use_sentence_case", async () => {
    const { app } = await mountRail([agent("lowercase", "idle", "authored status", { model: "m-opus" })]);
    app.handlers["models.list"] = () => LIST;
    fireEvent.contextMenu(rowOf("lowercase"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Model…" }));
    const dialog = screen.getByRole("dialog", { name: "Model for lowercase" });
    const select = await screen.findByRole("combobox", { name: "Model for lowercase" });
    fireEvent.change(select, { target: { value: "m-sonnet" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    expect(within(dialog).getAllByRole("button").map((button) => button.textContent)).toEqual(["Change", "Cancel"]);
    expect(within(dialog).getByText(/^Change lowercase to Sonnet/)).toBeTruthy();
  });

  it("u471_previous_copy_assertions_are_preserved_default_model_in_a_confirmation_stays_sentence_case", async () => {
    const { app } = await mountRail([agent("lowercase", "idle", "authored status", { model: "m-opus" })]);
    app.handlers["models.list"] = () => LIST;
    fireEvent.contextMenu(rowOf("lowercase"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Model…" }));
    const select = await screen.findByRole("combobox", { name: "Model for lowercase" });
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(screen.getByText(/^Change lowercase to default\?/)).toBeTruthy();
  });

  it("u471_previous_copy_assertions_are_preserved_rail_removal_summary_keeps_glossary_capitals", async () => {
    await mountRail([workstream("workstream"), agent("lowercase", "working", "authored status", { parent: "workstream" })]);
    fireEvent.contextMenu(rowOf("workstream"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove" }));

    expect(await screen.findByText("Goes: Nothing")).toBeTruthy();
    expect(screen.getByText("Stays at the Project root: 1 Agents")).toBeTruthy();
    expect(screen.getByText("lowercase: Running")).toBeTruthy();
    expect(screen.getByText("Remove workstream?")).toBeTruthy();
  });
});
