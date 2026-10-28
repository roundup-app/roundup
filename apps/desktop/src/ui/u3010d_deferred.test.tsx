import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { Deferred } from "./Deferred";

afterEach(cleanup);

it("u3010d_a_failed_surface_load_can_retry_its_first_opening", async () => {
  let calls = 0;
  let release: (value: string) => void = () => {};
  const pending = new Promise<string>(resolve => { release = resolve; });
  render(() => <Deferred label="Pads" load={() => ++calls === 1 ? Promise.reject(new Error("Pads could not load; retry.")) : pending}>
    {name => <input aria-label="Pad name" value={name} />}
  </Deferred>);
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  expect(calls).toBe(2);
  expect(await screen.findByRole("status", { name: "Pads" })).toBeTruthy();
  release("original pad");
  expect(await screen.findByDisplayValue("original pad")).toBeTruthy();
});
