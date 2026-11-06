import { cleanup } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, node, workstream } from "../testing/nodes";
import { chooseFooter, mountRail, rowNames, settled } from "./railFixture";

afterEach(cleanup);

const actor = { kind: "user", id: "user", parent: null } as const;

const creates = [
  { name: "Agent" as const, method: "agent.spawn" as const, made: () => agent("made", "working", "starting") },
  { name: "Workstream" as const, method: "rail.createWorkstream" as const, made: () => workstream("made") },
];

/** Each order the Daemon's `rail.changed` and the create's reply can reach the App in. */
const orders = ["event before reply", "reply before event"] as const;

it.each(creates.flatMap(create => orders.map(order => [create.name, order, create] as const)))("u5991f_new_%s_never_shows_two_rows_for_one_create_%s", async (_name, order, create) => {
  const mounted = await mountRail([agent("a", "idle", "ready", { terminal_id: null })]);
  const answered = Promise.withResolvers<void>();
  let tree = [node("a", { status: { kind: "idle", label: "ready", since: 0, finished: "0" }, terminal_id: null })];

  mounted.app.handlers["rail.tree"] = () => tree;
  // SAFETY: the fake reply carries only the fields the App reads from the created row, which both methods' results share.
  mounted.app.handlers[create.method] = (async () => {
    await answered.promise;

    return create.made();
  }) as never;

  const frames: string[][] = [];

  const frame = async () => {
    await settled();
    frames.push(rowNames());
  };


  await chooseFooter(create.name);
  await frame();

  if (order === "event before reply") {
    tree = [...tree, create.made()];
    mounted.app.emit({ name: "rail.changed", actor });
    await frame();
    answered.resolve();
    await frame();
  } else {
    tree = [...tree, create.made()];
    answered.resolve();
    await frame();
    mounted.app.emit({ name: "rail.changed", actor });
    await frame();
  }

  await mounted.rail.settled();
  await frame();

  // One existing row plus the one created: no frame draws a second row for the same create.
  expect(frames.map(rows => rows.length)).toEqual(frames.map(() => 2));
  expect(rowNames()).toHaveLength(2);
});
