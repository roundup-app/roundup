import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { checkboxNamed, LIST, mountSheet, selectNamed, settings } from "./modelsFixture";

afterEach(cleanup);

const select = selectNamed;

const setModelsCalls = (app: { calls: { method: string; params: unknown }[] }) => app.calls.filter((call) => call.method === "project.setModels").map((call) => call.params);

describe("u377 the Models sheet", () => {
  it("u377_one_row_per_role_from_the_daemon", async () => {
    await mountSheet(settings(["door", "subagent", "scribe", "future"]));
    await select("Model for door");

    const rows = [...document.querySelectorAll(".models-row")].map((row) => row.querySelector(".models-role")?.textContent);

    expect(rows).toEqual(["door", "subagent", "scribe", "future"]);
    expect((await select("Effort for future")).getAttribute("aria-label")).toBe("Effort for future");
  });

  it("u377_default_is_first_and_means_null", async () => {
    const { app } = await mountSheet(settings(["door"]));
    const model = await select("Model for door");

    expect([...model.options].map((option) => option.textContent)).toEqual(["Default", "Opus", "Sonnet"]);
    expect([...(await select("Effort for door")).options].map((option) => option.textContent)).toEqual(["Default", "Low", "High"]);
    expect(model.value).toBe("");

    model.value = "m-opus";
    fireEvent.change(model);
    await waitFor(() => expect(setModelsCalls(app)).toHaveLength(1));
    model.value = "";
    fireEvent.change(model);
    await waitFor(() => expect(setModelsCalls(app)[1]).toEqual({ roles: [{ role: "door", model: null, effort: null }], allowed: [] }));
  });

  it("u377_the_allowed_list_starts_empty", async () => {
    await mountSheet(settings(["door"]));
    await select("Model for door");

    const boxes = [...document.querySelectorAll<HTMLInputElement>('.models-allowed input[type="checkbox"]')];

    expect(screen.getByText("Supervisors may use")).toBeTruthy();
    expect(screen.getByText("A supervisor can start a child only on a checked Model.")).toBeTruthy();
    expect(boxes.map((box) => box.checked)).toEqual([false, false]);
    expect(boxes).toHaveLength(LIST.models.length);
  });

  it("u377_a_change_calls_set_models_once_with_the_whole_state", async () => {
    const { app } = await mountSheet(settings(["door", "scribe"], ["m-sonnet"]));
    const effort = await select("Effort for scribe");

    effort.value = "e-high";
    fireEvent.change(effort);
    await waitFor(() => expect(setModelsCalls(app)).toHaveLength(1));

    expect(setModelsCalls(app)[0]).toEqual({
      roles: [{ role: "door", model: null, effort: null }, { role: "scribe", model: null, effort: "e-high" }],
      allowed: ["m-sonnet"],
    });

    fireEvent.click(screen.getByLabelText("Opus"));
    await waitFor(() => expect(setModelsCalls(app)).toHaveLength(2));
    expect(setModelsCalls(app)[1]).toEqual({
      roles: [{ role: "door", model: null, effort: null }, { role: "scribe", model: null, effort: "e-high" }],
      allowed: ["m-sonnet", "m-opus"],
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("u377_a_failure_shows_the_error_line_and_keeps_the_stored_value", async () => {
    const { app } = await mountSheet(settings(["door"]));
    app.handlers["project.setModels"] = () => {
      throw new RpcError(-32602, "unknown model m-opus");
    };

    const model = await select("Model for door");

    model.value = "m-opus";
    fireEvent.change(model);

    expect((await screen.findByRole("alert")).textContent).toContain("unknown model m-opus");
    expect(model.value).toBe("");

    const box = checkboxNamed("Sonnet");

    fireEvent.click(box);
    await waitFor(() => expect(box.checked).toBe(false));
  });

  it("u377_all_long_authored_labels_are_available", async () => {
    const long = "L".repeat(40);
    const list = { models: Array.from({ length: 20 }, (_, at) => ({ id: `m${at}`, label: `${long}${at}` })), efforts: [{ id: "e", label: long }] };

    await mountSheet(settings([long]), list);
    await select(`Model for ${long}`);

    expect(document.querySelectorAll(".models-allowed .models-check")).toHaveLength(20);
  });

  it("m2219_the_mcp_toggle_reads_project_get_and_calls_set_mcp_once", async () => {
    const { app } = await mountSheet({ ...settings(["door"]), mcp: { on: false } });
    await select("Model for door");

    const box = checkboxNamed("Roundup tools over MCP");

    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(app.calls.filter((call) => call.method === "project.setMcp").map((call) => call.params)).toEqual([{ on: true }]));
  });
});
