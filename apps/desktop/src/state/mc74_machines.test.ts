import { createRoot, createSignal } from "solid-js";
import { expect, it } from "vitest";
import type { Machine } from "@contracts/machine/Machine";
import { createFakeApp } from "../testing/fakeApp";
import { createMachines } from "./machines";

const read = async (list: Machine[], choose = "") => {
  const app = createFakeApp();
  app.handlers["machine.list"] = () => ({ machines: list, version: "0.1.21" });

  return await createRoot(async dispose => {
    const [tick] = createSignal(0);
    const machines = createMachines(app, tick, () => null);
    machines.nameStart(choose);
    machines.watch(() => true);
    await new Promise(resolve => setTimeout(resolve, 20));
    const seen = { any: machines.any(), names: machines.names(), start: machines.start() };
    dispose();

    return seen;
  });
};

it("mc74_an_unreachable_only_machine_leaves_no_chip_on_a_local_agent", async () => {
  expect((await read([{ name: "dead", details: {}, reachable: false }])).any).toBe(false);
});

it("mc74_a_reachable_machine_brings_the_chip_back", async () => {
  expect((await read([{ name: "dead", details: {}, reachable: false }, { name: "box", details: {} }])).names).toEqual(["box"]);
});

it("mc76_a_chosen_machine_clears_when_it_goes_away", async () => {
  expect((await read([], "box")).start).toBe("");
  expect((await read([{ name: "box", details: {}, reachable: true }], "box")).start).toBe("box");
});
