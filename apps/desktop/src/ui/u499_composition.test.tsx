import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { u498Fixture } from "./u498Fixture";

afterEach(cleanup);

it("u499_part_props_and_refs", () => {
  render(u498Fixture);
  const list = screen.getByRole("tablist", { name: "Shelf views" });
  const trigger = screen.getByRole("tab", { name: "Todos" });
  const panel = screen.getByRole("tabpanel", { name: "Todos" });

  expect([list.dataset.caller, trigger.dataset.caller, panel.dataset.caller]).toEqual(["list", "trigger", "panel"]);
  expect([list.classList.contains("caller-list"), trigger.classList.contains("caller-trigger"), panel.classList.contains("caller-panel")]).toEqual([true, true, true]);
  expect(trigger.dataset.ref).toBe("connected");
});
