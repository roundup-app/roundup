import { describe, expect, it } from "vitest";
import type { Ask } from "@contracts/ask/Ask";
import { RpcError } from "../app/seam";
import { connectEvents } from "../app/events";
import { createFakeApp } from "../testing/fakeApp";
import { createAsks } from "./asks";

const ask = (id: string, submission = id): Ask => ({
  id,
  text: "tidy",
  at: 1n,
  submission,
  parts: [{ text: "tidy", placement: { kind: "unclear", question: "", candidates: [] }, state: "waiting" }],
});

const open = async () => {
  const app = createFakeApp();
  app.handlers["ask.list"] = () => [ask("a1"), ask("a2")];
  const asks = createAsks(app, await connectEvents(app));

  return { app, asks };
};

const deferred = () => {
  let release!: (value: Ask) => void;
  const promise = new Promise<Ask>((resolve) => { release = resolve; });

  return { promise, release };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("p3557c_failure_lifetime_ask_state", () => {
  it("p3557c_failure_lifetime_ask_state_part_failure_lifetime", async () => {
    const { app, asks } = await open();
    const retry = deferred();

    app.handlers["ask.pick"] = () => { throw new RpcError(-32000, "no"); };

    expect(await asks.pick("a1", 0, { kind: "drop" })).toBe("no");
    const first = asks.partFailure("a1", 0)!;
    expect(asks.pickFailure("a1", 0)).toBe("no");

    // A retry in flight keeps the failure; a failed Drop replaces it with a new identity.
    app.handlers["ask.pick"] = () => retry.promise;
    const pending = asks.pick("a1", 0, { kind: "new" });
    expect(asks.partFailure("a1", 0)).toBe(first);
    expect(asks.picking("a1", 0)).toBe(true);
    retry.release(ask("a1"));
    await pending;
    expect(asks.partFailure("a1", 0)).toBeUndefined();


    app.handlers["ask.pick"] = () => { throw new RpcError(-32000, "no"); };

    await asks.pick("a1", 0, { kind: "drop" });
    const second = asks.partFailure("a1", 0)!;
    expect(second.id).not.toBe(first.id);

    // A stale dismissal with equal text does not clear the later failure; an unrelated part's success does not either.
    asks.dismiss(first);
    expect(asks.partFailure("a1", 0)).toBe(second);
    app.handlers["ask.pick"] = () => ask("a2");

    await asks.pick("a2", 0, { kind: "drop" });
    expect(asks.partFailure("a1", 0)).toBe(second);
    app.handlers["ask.send"] = (params) => ask("a3", params.submission);

    await asks.send({ text: "x", submission: "s1" });
    expect(asks.partFailure("a1", 0)).toBe(second);

    const calls = app.calls.length;
    asks.dismiss(second);
    expect(asks.partFailure("a1", 0)).toBeUndefined();
    expect(app.calls.length).toBe(calls);
  });

  it("p3557c_failure_lifetime_ask_state_list_failure_is_isolated", async () => {
    const { app, asks } = await open();

    app.handlers["ask.list"] = () => { throw new RpcError(-32000, "list down"); };

    asks.load();
    await settle();
    const failure = asks.listFailure()!;
    expect(asks.failure()).toBe("list down");

    app.handlers["ask.send"] = (params) => ask("a3", params.submission);

    await asks.send({ text: "x", submission: "s1" });
    expect(asks.listFailure()).toBe(failure);


    app.handlers["ask.send"] = () => { throw new RpcError(-32602, "bad"); };

    await asks.send({ text: "y", submission: "s2", workstream: "ops" });
    expect(asks.listFailure()).toBe(failure);
    expect(asks.intakeFailure()).toMatchObject({ kind: "refused", submission: "s2", destination: "ops", message: "bad" });
    asks.dismiss(failure);
    expect(asks.listFailure()).toBeNull();
    expect(asks.intakeFailure()?.submission).toBe("s2");

    app.handlers["ask.list"] = () => [ask("a1")];

    app.handlers["ask.send"] = () => { throw new RpcError(-32603, "internal"); };

    await asks.send({ text: "z", submission: "s3" });
    expect(asks.intakeFailure()).toMatchObject({ kind: "unknown", submission: "s3", destination: null });
    expect(await asks.reconcile("s3")).toMatchObject({ kind: "unknown" });
    expect(asks.intakeFailure()?.submission).toBe("s3");
  });

  it("p3557c_failure_lifetime_ask_state_list_recovery_clears_its_failure", async () => {
    const { app, asks } = await open();

    app.handlers["ask.list"] = () => { throw new RpcError(-32000, "list down"); };

    asks.load();
    await settle();
    expect(asks.listFailure()).not.toBeNull();

    app.handlers["ask.list"] = () => [ask("a1")];

    asks.load();
    await settle();
    expect(asks.listFailure()).toBeNull();
    expect(asks.entries().map((entry) => entry.key)).toEqual(["a1"]);
  });
});
