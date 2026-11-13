import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { createRoot } from "solid-js";
import { afterEach, expect, it } from "vitest";
import { copy as windowCopy } from "../window/copy";
import { openTabs, path, projectTabs, tab } from "../header/stripFixture";
import { createFakeApp } from "../testing/fakeApp";
import { agent, event } from "../testing/nodes";
import { connectProject } from "./connectedProject";

afterEach(cleanup);

const mark = (name: string) => tab(name).querySelector(".tab-mark")?.getAttribute("data-kind");

it("u6920a_a_failed_reconnect_keeps_the_last_connection", async () => {
  const { app } = await openTabs({ api: [agent("ask", "needs-you", "x")], web: [] });
  const daemon = app.of(path("api"));

  expect(mark("api")).toBe("needs-you");

  daemon.subscribe = async () => {
    throw new Error("the Daemon's socket closed");
  };

  daemon.handlers["rail.tree"] = () => [agent("calm", "idle", "x")];
  app.exitDaemon({ code: null, recovery: "connecting" }, path("api"));

  await waitFor(() => expect(tab("api").getAttribute("aria-busy")).toBe("false"));
  expect(mark("api")).toBe("needs-you");
  expect(projectTabs()).toHaveLength(2);

});

it("u6920a_the_next_successful_connect_replaces_last", async () => {
  const { app } = await openTabs({ api: [agent("ask", "needs-you", "x")], web: [] });
  const daemon = app.of(path("api"));
  const subscribe = daemon.subscribe;

  daemon.subscribe = async () => {
    throw new Error("the Daemon's socket closed");
  };

  app.exitDaemon({ code: null, recovery: "connecting" }, path("api"));
  await waitFor(() => expect(tab("api").getAttribute("aria-busy")).toBe("false"));

  daemon.subscribe = subscribe;
  daemon.handlers["rail.tree"] = () => [agent("calm", "idle", "x")];
  app.exitDaemon({ code: null, recovery: "connecting" }, path("api"));

  await waitFor(() => expect(mark("api")).not.toBe("needs-you"));
});

it("u6920b_a_recovered_connection_does_not_clear_a_newer_exit", async () => {
  const { app } = await openTabs({ api: [], web: [] });
  const daemon = app.of(path("web"));
  let release = () => {};

  const gate = new Promise<void>(done => (release = done));

  daemon.handlers["rail.tree"] = async () => {
    await gate;

    return [];
  };

  app.exitDaemon({ code: null, recovery: "connecting" }, path("web"));
  await waitFor(() => expect(daemon.calls.filter(call => call.method === "rail.tree")).toHaveLength(2));

  app.exitDaemon({ code: 1 }, path("web"));
  release();

  await waitFor(() => expect(daemon.calls.filter(call => call.method === "terminal.list").length).toBeGreaterThan(1));
  await waitFor(() => expect(tab("web").getAttribute("aria-busy")).toBe("false"));
  expect(screen.getByRole("button", { name: windowCopy.reopen })).toBeTruthy();
});

it("u6920b_a_connect_under_the_exit_it_finishes_under_clears_it", async () => {
  const { app } = await openTabs({ api: [], web: [] });

  app.exitDaemon({ code: 1 }, path("web"));
  fireEvent.click(await screen.findByRole("button", { name: windowCopy.reopen }));

  await waitFor(() => expect(screen.queryByRole("button", { name: windowCopy.reopen })).toBeNull());
});

it("u6920c_a_tab_closed_during_setup_disposes_every_child_root", async () => {
  const app = createFakeApp();
  let release = () => {};

  const gate = new Promise<void>(done => (release = done));

  app.handlers["rail.tree"] = async () => {
    await gate;

    return [];
  };

  let close = () => {};

  const connecting = createRoot(dispose => {
    close = dispose;

    return connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);
  });

  const outcome = connecting.then(() => "connected", () => "closed");

  await waitFor(() => expect(app.calls.some(call => call.method === "rail.tree")).toBe(true));
  close();
  release();

  expect(await outcome).toBe("closed");

  const before = app.calls.map(call => call.method);

  app.emit(event({ name: "rail.changed" }));
  await new Promise(resolve => setTimeout(resolve, 20));

  expect(app.calls.map(call => call.method)).toEqual(before);
});
