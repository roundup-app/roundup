import { expect, it } from "vitest";
import { agent, info } from "../testing/nodes";
import { entriesOf } from "./entries";

it("ps11_the_switcher_orders_terminals_with_agents_by_kind_urgency", () => {
  const entries = entriesOf(
    [agent("a", "working", "busy", { name: "alpha" }), agent("b", "needs-you", "asks", { name: "beta", order: 1 })],
    [
      info("1", { owner: "a", title: "failing", status: { kind: "error", label: "", since: 0, finished: "0" } }),
      info("2", { owner: "a", title: "quiet", status: { kind: "working", label: "", since: 0, finished: "0" } }),
    ],
  );

  expect(entries.map(entry => entry.label)).toEqual(["failing", "beta", "alpha", "quiet"]);
});
