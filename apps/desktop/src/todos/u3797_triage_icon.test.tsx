import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { mountTodos, todo } from "./testHarness";

afterEach(cleanup);

const shelf = () => document.querySelector(".shelf")!;

it("u3797_the_triage_icon_button_enters_and_leaves_triage_with_aria_pressed", async () => {
  await mountTodos([todo(1), todo(2)], true);
  const button = await screen.findByRole("button", { name: "Triage" });

  expect(button.textContent).toBe("");
  expect(button.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(button);
  await waitFor(() => expect(shelf().getAttribute("data-triage")).toBe("on"));
  expect(button.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(button);
  await waitFor(() => expect(shelf().getAttribute("data-triage")).toBe("off"));
  expect(button.getAttribute("aria-pressed")).toBe("false");
});

it("u3797_the_triage_tooltip_holds_the_t_chord", async () => {
  await mountTodos([todo(1)], true);
  const button = await screen.findByRole("button", { name: "Triage" });

  fireEvent.pointerOver(button, { pointerType: "mouse" });
  const tip = await screen.findByRole("tooltip");
  expect(tip.textContent).toContain("Triage");
  expect(tip.textContent).toContain("T");
});
