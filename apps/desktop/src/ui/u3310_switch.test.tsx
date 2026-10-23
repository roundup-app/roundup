import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { Switch } from "./Switch";

afterEach(cleanup);

it("u3310_pointer_requests_one_change_and_waits_for_the_caller", async () => {
  const change = vi.fn();
  const [checked, setChecked] = createSignal(false);

  render(() => <Switch checked={checked()} onCheckedChange={change}>Auto</Switch>);
  const control = screen.getByRole("switch", { name: "Auto" });

  fireEvent.click(control);
  await Promise.resolve();
  expect(change.mock.calls).toEqual([[true]]);
  expect(control.getAttribute("aria-checked")).toBe("false");
  setChecked(true);
  expect(control.getAttribute("aria-checked")).toBe("true");
});
