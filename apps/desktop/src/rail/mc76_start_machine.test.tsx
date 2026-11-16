import { cleanup, render, screen } from "@solidjs/testing-library";
import { createRoot, createSignal } from "solid-js";
import { afterEach, expect, it } from "vitest";
import type { Machine } from "@contracts/machine/Machine";
import { createFakeApp } from "../testing/fakeApp";
import { createMachines } from "../state/machines";
import { StartMachine } from "./StartMachine";

afterEach(cleanup);

/** The Rail shows `StartMachine` only while `names()` is non-empty (MC76); this mirrors that gate. */
const shown = async (list: Machine[]) => {
  const app = createFakeApp();
  app.handlers["machine.list"] = () => ({ machines: list, version: "0.1.21" });
  const [tick] = createSignal(0);

  const machines = createRoot(() => {
    const made = createMachines(app, tick, () => null);

    made.watch(() => true);

    return made;
  });

  await new Promise(resolve => setTimeout(resolve, 20));
  render(() => <>{machines.names().length > 0 ? <StartMachine machines={machines} /> : null}</>);

  return screen.queryAllByText("Machine").length > 0 || screen.queryAllByRole("combobox").length > 0;
};

it("mc76_the_start_machine_field_needs_an_online_machine", async () => {
  expect(await shown([])).toBe(false);
  cleanup();
  expect(await shown([{ name: "dead", details: {}, reachable: false }])).toBe(false);
  cleanup();
  expect(await shown([{ name: "box", details: {}, reachable: true }])).toBe(true);
});
