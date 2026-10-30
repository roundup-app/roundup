import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import type { Pad } from "@contracts/pad/Pad";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT,
  deferred,
  openShelf,
  padOf,
} from "./padsFixture";
import { agent, USER, workstream } from "../testing/nodes";

afterEach(cleanup);

describe("u18 list and ownership", () => {
  // u3736_pads_group_by_home_once_each replaces the simple name-list proof.
  it("u18_pad_changed_refetches_pad_list_and_logs_no_touch", async () => {
    const { app, state, calls } = await openShelf([padOf("auth-notes", AGENT)]);
    await screen.findByText("auth-notes");
    state.pads = [...state.pads, padOf("migrate-plan", AGENT)];

    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "migrate-plan" },
    });
    await screen.findByText("migrate-plan");

    expect(
      calls().filter(
        (method) => method !== "daemon.ping" && method !== "terminal.scheme" && method !== "rail.tree" && method !== "terminal.list" && method !== "workstream.queue",
      ),
    ).toEqual(["pad.list", "pad.list"]);
    await waitFor(() => expect(calls()).not.toContain("pad.read"));
  });

  it("u18_an_older_pad_list_reply_that_arrives_late_never_wins", async () => {
    const { app } = await openShelf([padOf("auth-notes", AGENT)]);
    await screen.findByText("auth-notes");
    const replies: ReturnType<typeof deferred<Pad[]>>[] = [];
    app.handlers["pad.list"] = () => {
      const reply = deferred<Pad[]>();
      replies.push(reply);

      return reply.promise;
    };

    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "auth-notes" },
    });
    await waitFor(() => expect(replies.length).toBe(1));
    app.emit({
      actor: AGENT,
      name: "pad.changed",
      data: { name: "auth-notes" },
    });
    await waitFor(() => expect(replies.length).toBe(2));
    const newest = replies.length - 1;

    replies.at(-1)?.resolve([padOf("newest", AGENT)]);
    await screen.findByText("newest");
    replies
      .slice(0, newest)
      .forEach((older) => older.resolve([padOf("older", AGENT)]));
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByText("older")).toBeNull();
  });
});

it("u3736_pads_group_by_home_once_each", async () => {
  const { app, connected } = await openShelf([
    { ...padOf("Beta", AGENT), home: "w1" },
    { ...padOf("alpha", USER), home: "w1" },
    { ...padOf("Elsewhere", AGENT), home: "w2" },
    padOf("Root", AGENT),
  ]);

  const tree = [workstream("w2", { name: "Second", order: 0 }), workstream("w1", { name: "First", order: 1 }), workstream("empty", { order: 2 }), agent("maker", "done", "stopped", { parent: "w1" })];
  app.handlers["rail.tree"] = () => tree;
  // pad.list already guarantees P3 order; this connected observer checks that grouping keeps it.
  app.handlers["pad.list"] = () => [
    { ...padOf("alpha", USER), home: "w1" }, { ...padOf("Beta", AGENT), home: "w1" },
    { ...padOf("Elsewhere", AGENT), home: "w2" }, padOf("Root", AGENT),
  ];
  await connected.rail.refresh();
  app.emit({ actor: USER, name: "pad.changed", data: { name: "alpha" } });
  const membership = () => [...document.querySelectorAll('.pads-tab [data-shelf-group]')].map(group => [group.getAttribute("data-shelf-group"), [...group.querySelectorAll("[data-pad]")].map(row => row.getAttribute("data-pad"))]);
  const expected = [["w2", ["Elsewhere"]], ["w1", ["alpha", "Beta"]], ["unassigned", ["Root"]]];
  await waitFor(() => expect(membership()).toEqual(expected));

  for (const selection of ["maker", "w2", null]) {
    connected.rail.select(selection);
    expect(membership()).toEqual(expected);
  }

  const group = document.querySelector('[data-shelf-group="w1"]')!;
  fireEvent.click(group.querySelector(".shelf-group-control")!);
  await waitFor(() => expect(group.getAttribute("aria-expanded")).toBe("false"));
  app.emit({ actor: USER, name: "pad.changed", data: { name: "alpha" } });
  await waitFor(() => expect(app.calls.filter(call => call.method === "pad.list")).toHaveLength(3));
  expect(group.getAttribute("aria-expanded")).toBe("false");
});

it("u3736_pad_home_events_refresh_groups", async () => {
  const { app, connected, state } = await openShelf([{ ...padOf("notes", AGENT), home: "w1" }]);
  let tree = [workstream("w1", { name: "Original" }), workstream("w2", { name: "Destination", order: 1 }), agent("maker", "working", "editing", { parent: "w1" })];
  app.handlers["rail.tree"] = () => tree;
  await connected.rail.refresh();
  await screen.findByText("Original");

  for (const maker of [agent("maker", "working", "editing", { name: "Renamed maker", parent: "w2" }), agent("maker", "done", "stopped", { parent: "w2" })]) {
    tree = [tree[0]!, tree[1]!, maker];
    await connected.rail.refresh();
    expect(document.querySelector('[data-pad="notes"]')?.closest('[data-shelf-group]')?.getAttribute('data-shelf-group')).toBe("w1");
  }

  tree = [workstream("w1", { name: "Renamed" }), tree[1]!];
  app.emit({ actor: USER, name: "rail.changed" });
  await screen.findByText("Renamed");
  expect(document.querySelector('[data-pad="notes"]')?.closest('[data-shelf-group]')?.getAttribute('data-shelf-group')).toBe("w1");
  state.pads = [{ ...state.pads[0]!, home: "w2" }];
  app.emit({ actor: USER, name: "pad.changed", data: { name: "notes" } });
  await waitFor(() => expect(document.querySelector('[data-pad="notes"]')?.closest('[data-shelf-group]')?.getAttribute('data-shelf-group')).toBe("w2"));
  expect(document.querySelector('[data-shelf-group="w1"]')).toBeNull();
});
