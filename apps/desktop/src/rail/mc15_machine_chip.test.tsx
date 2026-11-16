import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
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

it("mc3_icon_names_the_machine", async () => {
  await mountRail(nodes, [], undefined, undefined, { machines: [other] });
  await waitFor(() => expect(itemOf("alpha").querySelector(".machine-icon")?.getAttribute("aria-label")).toBe(alpha.machine));
});

it("u7205d_a_local_agent_shows_no_machine_mark", async () => {
  await mountRail(nodes, [], undefined, undefined, { machines: [other] });
  await waitFor(() => expect(itemOf("alpha").querySelector(".machine-icon")).not.toBeNull());
  expect(itemOf("gamma").querySelector(".row-machine")).toBeNull();
  expect(document.body.innerHTML.includes("This Mac")).toBe(false);
});

it("u7205d_a_remote_agent_shows_the_server_icon_with_the_machine_name_or_offline", async () => {
  await mountRail(nodes, [], undefined, undefined, { machines: [box(false), other] });
  await waitFor(() => expect(itemOf("alpha").querySelector(".machine-icon[data-offline] svg")?.parentElement?.getAttribute("aria-label")).toBe(copy.machineOffline));
  const icon = itemOf("beta").querySelector<HTMLElement>(".machine-icon");

  if (icon === null) throw new Error("missing icon");


  expect(icon.hasAttribute("data-offline")).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.pointerEnter(icon, { pointerType: "mouse", clientX: 0, clientY: 0 });
  await waitFor(() => expect(screen.getByRole("tooltip").textContent).toBe(icon.getAttribute("aria-label")));
});
