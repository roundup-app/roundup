import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, door, NOW } from "../testing/nodes";
import { mountRail, rowOf, settled } from "./railFixture";

afterEach(cleanup);

const LABEL = "Claude could not sign in; open its Terminal, sign in, then retry.";

const failed = (id: string, extra = {}) => agent(id, "error", "x", { status: { kind: "error", label: LABEL, since: NOW, finished: "0" }, ...extra });

const lineOf = (name: string) => rowOf(name).querySelector("[data-failure]");

it("u6249d_failure_is_dismissable_and_on_one_row", async () => {
  const { rail } = await mountRail([failed("one"), failed("two")]);

  // × removes the line it sits on, and only that one.
  expect(lineOf("one")).not.toBeNull();
  fireEvent.click(within(rowOf("one")).getByRole("button", { name: "Dismiss" }));
  await settled();
  expect(lineOf("one")).toBeNull();
  expect(lineOf("two")).not.toBeNull();

  // Escape on the focused row removes its line, as the Dismiss does.
  rowOf("two").focus();
  fireEvent.keyDown(rowOf("two"), { key: "Escape" });
  await settled();
  expect(lineOf("two")).toBeNull();
  expect(rail.nodes.filter(node => rail.dismissed(node))).toHaveLength(2);

  // A dismissed failure shows nothing, selected or not.
  fireEvent.click(rowOf("one"));
  await settled();
  expect(lineOf("one")).toBeNull();
});

it("u6249d_failure_is_dismissable_and_on_one_row: a child's line is on its row, the Workstream's only while folded", async () => {
  await mountRail([
    door("w", "idle", "ready", { name: "payments", workstream_state: "idle" }),
    agent("a", "idle", "ready", { parent: "w", name: "helper", unreachable: "inbox write failed" }),
  ]);

  expect(rowOf("helper").querySelector(".rail-unreachable")).not.toBeNull();
  expect(rowOf("payments").querySelector(".rail-unreachable")).toBeNull();

  fireEvent.click(within(rowOf("payments")).getByRole("button", { name: "Collapse" }));
  await waitFor(() => expect(rowOf("payments").querySelector(".rail-unreachable")).not.toBeNull());
});

it("u6249c_gone_target_drops_silently", async () => {
  const tree = [agent("a", "idle", "x", { name: "gone" }), agent("b", "idle", "x", { name: "kept", order: 1 })];
  const { rail, connected } = await mountRail(tree);

  connected.held.retain({ agent: "a", name: "gone", kind: "error", line: "boom", at: 1 });
  connected.held.retain({ agent: "b", name: "kept", kind: "error", line: "boom", at: 2 });
  tree.splice(0, 1);
  await rail.refresh();

  fireEvent.click(screen.getByRole("button", { name: /held/ }));
  const goneRow = () => [...document.querySelectorAll(".held-row")].find(each => each.textContent?.includes("gone"));

  await waitFor(() => expect(goneRow()).toBeDefined());
  fireEvent.click(goneRow()!);

  await waitFor(() => expect(connected.held.rows().map(row => row.agent)).toEqual(["b"]));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(rail.commandFailure.message()).toBeNull();
});
