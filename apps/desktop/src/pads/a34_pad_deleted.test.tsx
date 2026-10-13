import { cleanup, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { Pad } from "@contracts/pad/Pad";
import { AGENT, deferred, openPad, openShelf, padOf, RpcError } from "./padsFixture";

afterEach(cleanup);

it("a34_pad_deleted_refreshes_the_pad_list_through_the_fake_app_seam", async () => {
  const { app, state, calls } = await openShelf([padOf("plan", AGENT)]);
  await screen.findByText("plan");
  state.pads = [padOf("kept", AGENT)];

  app.emit({ actor: AGENT, name: "pad.deleted", data: { name: "plan" } });
  await screen.findByText("kept");

  expect(screen.queryByText("plan")).toBeNull();
  expect(calls().filter((method) => method === "pad.list")).toHaveLength(2);
});

it("a34_pad_deleted_cannot_leave_the_pad_cached_when_refresh_fails", async () => {
  const { app } = await openShelf([padOf("plan", AGENT)]);
  await screen.findByText("plan");
  app.handlers["pad.list"] = () => {
    throw new RpcError(-32001, "cannot list Pads");
  };

  app.emit({ actor: AGENT, name: "pad.deleted", data: { name: "plan" } });
  await screen.findByText("cannot list Pads");

  await waitFor(() => expect(screen.queryByText("plan")).toBeNull());
});

it("a34_pad_deleted_marks_an_open_drawer_as_deleted", async () => {
  const { app, state } = await openShelf([padOf("plan", AGENT, "saved text")]);
  await openPad("plan");
  state.pads = [];

  app.emit({ actor: AGENT, name: "pad.deleted", data: { name: "plan" } });

  expect((await screen.findByText("Pad plan was deleted")).textContent).toBe("Pad plan was deleted");
});

it("a34_an_older_pad_list_reply_cannot_restore_a_deleted_pad", async () => {
  const { app } = await openShelf([padOf("plan", AGENT)]);
  await screen.findByText("plan");
  const older = deferred<Pad[]>();
  let reads = 0;
  app.handlers["pad.list"] = () => (++reads === 1 ? older.promise : []);
  app.emit({ actor: AGENT, name: "pad.changed", data: { name: "plan" } });
  await waitFor(() => expect(reads).toBe(1));

  app.emit({ actor: AGENT, name: "pad.deleted", data: { name: "plan" } });
  await screen.findByText("No Pads yet");
  older.resolve([padOf("plan", AGENT)]);
  // fakeApp.rpc unwraps the deferred reply before reload resumes, in two microtasks.
  await Promise.resolve();
  await Promise.resolve();

  expect(screen.queryByText("plan")).toBeNull();
});
