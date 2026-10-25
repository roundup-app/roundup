import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { deleteTodos } from "./deleteTodos";
import { mountTodos, todo } from "./testHarness";
import type { DeleteParams } from "@contracts/todo/DeleteParams";
import { RpcError } from "../app/seam";

afterEach(cleanup);

it("u3787a_fake_app_restoration_refreshes_the_same_graph", async () => {
  const { app } = await mountTodos([todo(1), todo(2, { blockers: [1], blocked: true })]);
  const before = await app.rpc("todo.list", null);
  const deletion = await deleteTodos(app, [1]);
  await app.rpc("todo.restore", { operation: deletion.operation });
  await screen.findByRole("button", { name: /#1 / });
  expect(await app.rpc("todo.list", null)).toEqual(before);
});

it("u3787a_lost_acknowledgement_reconciles_the_retained_operation", async () => {
  const { app } = await mountTodos([todo(1)]);
  const remove = app.handlers["todo.delete"]!;
  app.handlers["todo.delete"] = async params => { await remove(params); throw new RpcError(-32004, "lost reply"); };

  const result = await deleteTodos(app, [1]);
  expect(result.deleted).toEqual([1]);
  expect(app.calls.filter(call => call.method === "todo.delete")).toHaveLength(1);
  await app.rpc("todo.restore", { operation: result.operation });
  expect((await app.rpc("todo.list", null)).map(todo => todo.id)).toEqual([1]);
});

it("u3787a_unknown_retries_keep_the_captured_operation_key", async () => {
  const { app } = await mountTodos([todo(1)]);
  const requests: DeleteParams[] = [];
  const remove = app.handlers["todo.delete"]!;
  app.handlers["todo.delete"] = params => { requests.push(params); throw new RpcError(-32004, "unknown"); };

  await expect(deleteTodos(app, [1])).rejects.toThrow("unknown");
  app.handlers["todo.delete"] = params => {
    requests.push(params);

    return remove(params)!;
  };

  await deleteTodos(app, [1]);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});
