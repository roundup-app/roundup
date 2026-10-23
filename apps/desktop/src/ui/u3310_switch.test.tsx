import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { Switch } from "./Switch";

afterEach(cleanup);

it.each([false, true])("u3310_pointer_requests_one_change_and_waits_for_the_caller_from_%s", async (initial) => {
  const change = vi.fn();
  const [checked, setChecked] = createSignal(initial);

  render(() => <Switch checked={checked()} onCheckedChange={change}>Auto</Switch>);
  const control = screen.getByRole<HTMLInputElement>("switch", { name: "Auto" });

  fireEvent.click(control);
  await Promise.resolve();
  expect(change.mock.calls).toEqual([[!initial]]);
  expect(control.getAttribute("aria-checked")).toBe(String(initial));
  expect(control.checked).toBe(initial);
  setChecked(!initial);
  expect(control.getAttribute("aria-checked")).toBe(String(!initial));
  expect(control.checked).toBe(!initial);
});

it("u3310_disabled_pointer_invokes_nothing", () => {
  const change = vi.fn();

  render(() => <Switch checked={false} disabled onCheckedChange={change}>Auto</Switch>);
  const control = screen.getByRole<HTMLInputElement>("switch", { name: "Auto" });

  control.click();
  expect(control.disabled).toBe(true);
  expect(change).not.toHaveBeenCalled();
});
