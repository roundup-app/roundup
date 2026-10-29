import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { u498Fixture } from "./u498Fixture";

afterEach(() => { cleanup(); history.replaceState(null, "", "/"); });

it("u499_part_props_and_refs", () => {
  render(u498Fixture);
  const list = screen.getByRole("tablist", { name: "Shelf views" });
  const trigger = screen.getByRole("tab", { name: "Todos" });
  const panel = screen.getByRole("tabpanel", { name: "Todos" });

  expect([list.dataset.caller, trigger.dataset.caller, panel.dataset.caller]).toEqual(["list", "trigger", "panel"]);
  expect([list.classList.contains("caller-list"), trigger.classList.contains("caller-trigger"), panel.classList.contains("caller-panel")]).toEqual([true, true, true]);
  expect(trigger.dataset.ref).toBe("connected");
});

it("u499_controlled_selection", async () => {
  history.replaceState(null, "", "?controlled");
  render(u498Fixture);
  fireEvent.click(screen.getByRole("tab", { name: "Pads" }));
  await waitFor(() => expect(screen.getByLabelText("Requests").textContent).toBe("1:pads"));
  expect(screen.getByRole("tab", { name: "Todos" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Pads" }).getAttribute("aria-selected")).toBe("true"));
  fireEvent.click(screen.getByRole("button", { name: "External Todos" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Todos" }).getAttribute("aria-selected")).toBe("true"));
  expect(screen.getByLabelText("Requests").textContent).toBe("1:pads");
});

it("u499_content_retention", async () => {
  history.replaceState(null, "", "?content");
  render(u498Fixture);
  const panels = [...document.querySelectorAll('[data-draft]')];

  for (const name of ["Todos", "Pads"]) {
    fireEvent.click(screen.getByRole("tab", { name }));
    await screen.findByRole("tabpanel", { name });
    fireEvent.input(screen.getByRole("textbox", { name: `${name} draft` }), { target: { value: `Keep this ${name}` } });
    fireEvent.click(screen.getByRole("button", { name: `Increment ${name}` }));
  }

  for (const name of ["Todos", "Pads"]) {
    fireEvent.click(screen.getByRole("tab", { name }));
    const panel = await screen.findByRole("tabpanel", { name });
    expect(screen.getByRole<HTMLInputElement>("textbox", { name: `${name} draft` }).value).toBe(`Keep this ${name}`);
    expect(screen.getByLabelText(`${name} count`).textContent).toBe("1");
    expect(panels.includes(panel.querySelector('[data-draft]')!)).toBe(true);
    expect(panel.querySelector<HTMLElement>('[data-draft]')!.dataset.mount).toBe("1");
  }
});
