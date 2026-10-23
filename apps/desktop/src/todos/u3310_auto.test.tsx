import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { RpcError } from "../app/seam";
import { workstream, event } from "../testing/nodes";
import { mountTodos, todo, todoCallsTo } from "./testHarness";
import { withScopeRow } from "../testing/showEverything";

afterEach(cleanup);

const mount = async () => {
  const node = workstream("w", { name: "Writing", auto: false });
  const mounted = await mountTodos([todo(1, { home: "w" })], true, [node]);
  mounted.connected.rail.select("w");

  return { ...mounted, node };
};

it("u3310_the_switch_calls_set_auto_once_and_follows_the_event", async () => {
  const { app, node } = await mount();
  let finish!: () => void;
  app.handlers["workstream.setAuto"] = () => new Promise<null>(resolve => { finish = () => resolve(null); });
  fireEvent.click(screen.getByRole("switch", { name: "Auto" }));
  await waitFor(() => expect(todoCallsTo(app, "workstream.setAuto")).toEqual([{ method: "workstream.setAuto", params: { id: "w", auto: true } }]));
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
  app.handlers["rail.tree"] = () => withScopeRow([{ ...node, auto: true }]);
  app.emit(event({ name: "workstream.updated", data: { ...node, auto: true } }));
  finish();
  await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true"));
  expect(screen.getByText("the Door is handing these out")).toBeTruthy();
});

it("u3310_the_switch_is_absent_without_a_workstream", async () => {
  await mountTodos([todo(1)]);
  expect(screen.queryByRole("switch")).toBeNull();
});

it("u3310_a_refused_call_keeps_the_state_and_shows_its_cause", async () => {
  const { app } = await mount();
  app.handlers["workstream.setAuto"] = () => { throw new RpcError(-32004, "Door stopped"); };

  fireEvent.click(screen.getByRole("switch", { name: "Auto" }));
  expect(await screen.findByText(/Door stopped/)).toBeTruthy();
  expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
});
