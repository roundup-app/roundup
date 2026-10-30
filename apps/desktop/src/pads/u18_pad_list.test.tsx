import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import type { Pad } from "@contracts/pad/Pad";
import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT,
  deferred,
  openShelf,
  padOf,
} from "./padsFixture";
import { USER } from "../testing/nodes";

afterEach(cleanup);

describe("u18 list and ownership", () => {
  it("u18_the_pads_list_shows_each_pad_by_name", async () => {
    await openShelf([
      padOf("auth-notes", AGENT),
      padOf("release-checklist", USER),
    ]);

    expect(
      [
        await screen.findByText("auth-notes"),
        screen.getByText("release-checklist"),
      ].length,
    ).toBe(2);
  });





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
