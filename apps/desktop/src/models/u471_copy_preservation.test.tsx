import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountSheet, selectNamed, settings } from "./modelsFixture";

afterEach(cleanup);

it("u471_previous_copy_assertions_are_preserved_model_controls_use_sentence_case", async () => {
  await mountSheet(settings(["door"]));
  const model = await selectNamed("Model for door");
  const effort = await selectNamed("Effort for door");

  expect([model.options[0]?.textContent, effort.options[0]?.textContent]).toEqual(["Default", "Default"]);
});

it("u471_previous_copy_assertions_are_preserved_model_choices_and_role_ids_stay_as_written", async () => {
  await mountSheet(settings(["lowercase"]), {
    models: [{ id: "keep-model", label: "keep this MODEL" }],
    efforts: [{ id: "keep-effort", label: "keep this EFFORT" }],
  });
  await selectNamed("Model for lowercase");

  expect(screen.getByText("lowercase")).toBeTruthy();
  expect(screen.getAllByText("keep this MODEL")).toHaveLength(2);
  expect(screen.getByText("keep this EFFORT")).toBeTruthy();
});

it("u497_copy_preserves_authored_values_model_save_failure", async () => {
  const payload = "Authored failure: could not save — 雪; \"quoted\" <b>kept</b>";
  const { app } = await mountSheet(settings(["lowercase"]), { models: [{ id: "keep-model", label: "Adapter «Ünï» label" }], efforts: [{ id: "e", label: "e" }] });

  app.handlers["project.setModels"] = () => { throw new Error(payload); };

  const model = await selectNamed("Model for lowercase");
  fireEvent.change(model, { target: { value: "keep-model" } });

  expect((await screen.findByText(payload)).textContent).toBe(payload);
  expect(screen.getAllByText("Adapter «Ünï» label").length).toBeGreaterThan(0);
});
