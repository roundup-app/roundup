import { cleanup, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { Machine } from "@contracts/machine/Machine";
import { agent } from "../testing/nodes";
import { copy } from "./copy";
import { itemOf, mountRail } from "./railFixture";

afterEach(cleanup);

const BOX = "box";

const alpha = agent("a", "working", "go", { name: "alpha", machine: BOX });

const gamma = agent("c", "working", "go", { name: "gamma" });

const nodes = [alpha, agent("b", "working", "go", { name: "beta", machine: "other" }), gamma];

const box = (reachable: boolean): Machine => ({ name: BOX, details: {}, reachable });

const other: Machine = { name: "other", details: {} };

it("mc3_chip_names_the_machine", async () => {
  await mountRail(nodes, [], undefined, undefined, { machines: [other] });
  await waitFor(() => expect(within(itemOf("alpha")).queryByRole("img", { name: alpha.machine ?? "" })).not.toBeNull());
});

it("mc3_no_chip_for_this_mac_when_no_other_machine_exists", async () => {
  const { app } = await mountRail([gamma]);

  await waitFor(() => expect(app.calls.some(call => call.method === "machine.list")).toBe(true));
  expect(within(itemOf("gamma")).queryByRole("img", { name: copy.thisMac })).toBeNull();
});

it("mc3_this_mac_gets_a_chip_once_another_machine_exists", async () => {
  await mountRail(nodes, [], undefined, undefined, { machines: [other] });
  await waitFor(() => expect(within(itemOf("gamma")).queryByRole("img", { name: copy.thisMac })).not.toBeNull());
});

it("mc15_offline_machine_sets_status_on_its_rows_and_no_alert", async () => {
  await mountRail(nodes, [], undefined, undefined, { machines: [box(false), other] });
  await waitFor(() => expect(within(itemOf("alpha")).queryByRole("img", { name: copy.machineOfflineState(BOX) })).not.toBeNull());
  expect(within(itemOf("beta")).queryByRole("img", { name: copy.machineOfflineState("other") })).toBeNull();
  expect(within(itemOf("gamma")).queryByRole("img", { name: copy.machineOfflineState(copy.thisMac) })).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});
