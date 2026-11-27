import { flush } from "solid-js";
import { expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { connectEvents } from "../app/events";
import { createFakeApp } from "../testing/fakeApp";
import { agent, event } from "../testing/nodes";
import { attentionList } from "../rail/attention";
import { createRailState, type DismissalStorage } from "./rail";

const needs = (id: string, revision = "1") => agent(id, "needs-you", "stays your call", { attempt: "1", status_revision: revision });

const storageDouble = (saved: string[] | null = null): DismissalStorage & { saved: () => string[] | null } => {
  let kept = saved;

  const write = async (keys: string[]) => {
    kept = keys;

    return null;
  };

  return { read: () => kept, write, saved: () => kept };
};

const head = (rail: { nodes: readonly RailNode[] }): RailNode => {
  const node = rail.nodes[0];

  if (node === undefined) throw new Error("no node");

  return node;
};

const mount = async (tree: RailNode[], dismissals: DismissalStorage) => {
  const app = createFakeApp();
  app.handlers["rail.tree"] = () => tree;
  app.handlers["terminal.list"] = () => [];
  const rail = createRailState(app, await connectEvents(app), undefined, dismissals);
  await rail.settled();

  return { app, rail };
};

const waiting = (rail: Awaited<ReturnType<typeof mount>>["rail"]) => attentionList(rail.nodes, [], rail.dismissed).map(entry => entry.kind === "agent" ? entry.node.id : "");

it("u7915d_a_marked_done_needs_you_leaves_the_attention_list", async () => {
  const { rail } = await mount([needs("a"), needs("b")], storageDouble());

  expect(waiting(rail)).toEqual(["a", "b"]);
  rail.dismiss(head(rail));
  flush();
  expect(waiting(rail)).toEqual(["b"]);
});

it("u7915d_the_mark_survives_a_restart_and_stays_scoped", async () => {
  const store = storageDouble();
  const first = await mount([needs("a"), needs("b")], store);

  first.rail.dismiss(head(first.rail));
  const restarted = await mount([needs("a"), needs("b")], storageDouble(store.saved()));
  const otherProject = await mount([needs("a"), needs("b")], storageDouble());

  expect(waiting(restarted.rail)).toEqual(["b"]);
  expect(waiting(otherProject.rail)).toEqual(["a", "b"]);
});

it("u7915e_a_new_needs_you_shows_again", async () => {
  const { app, rail } = await mount([needs("a")], storageDouble());

  rail.dismiss(head(rail));
  flush();
  expect(waiting(rail)).toEqual([]);
  app.emit(event({ name: "agent.status", data: { status_revision: "2", attempt: "1", id: "a", status: { kind: "needs-you", label: "again", since: 2, finished: "0" } } }));
  flush();
  expect(waiting(rail)).toEqual(["a"]);
  expect(rail.dismissed(head(rail))).toBe(false);
});
