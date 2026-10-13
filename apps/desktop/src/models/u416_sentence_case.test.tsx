import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountSheet, selectNamed, settings } from "./modelsFixture";

afterEach(cleanup);

it("u416_model_controls_use_sentence_case", async () => {
  await mountSheet(settings(["door"]));
  const model = await selectNamed("Model for door");
  const effort = await selectNamed("Effort for door");

  expect([model.options[0]?.textContent, effort.options[0]?.textContent]).toEqual(["Default", "Default"]);
});

it("u416_model_choices_and_role_ids_stay_as_written", async () => {
  await mountSheet(settings(["lowercase"]), {
    models: [{ id: "keep-model", label: "keep this MODEL" }],
    efforts: [{ id: "keep-effort", label: "keep this EFFORT" }],
  });
  await selectNamed("Model for lowercase");

  expect(screen.getByText("lowercase")).toBeTruthy();
  expect(screen.getAllByText("keep this MODEL")).toHaveLength(2);
  expect(screen.getByText("keep this EFFORT")).toBeTruthy();
});
