import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { RpcError } from "../app/seam";
import { info, node } from "../testing/nodes";
import { connectFakeProject, fakeEmulators, mountPane, subscribed } from "./paneHarness";
import { createScreens } from "./screens";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/** `selectOutput` of the fake App refuses its next `refusals` calls, and the test can count the calls. */
const refuseOutput = (app: Awaited<ReturnType<typeof mountPane>>["app"], refusals: number) => {
  let calls = 0;
  let current: RpcError | null = null;
  let thrown = false;

  // The fake reads the property to test it and again to throw it: one subscribe call is one test plus, when refused, one throw.
  const read = (): RpcError | null => {
    if (thrown) {
      thrown = false;

      return current;
    }

    current = ++calls <= refusals ? new RpcError(-32603, "channel refused") : null;
    thrown = current !== null;

    return current;
  };

  Object.defineProperty(app, "outputFailure", { configurable: true, get: read });

  return () => calls;
};

it("u6249b_terminal_output_subscribing_retries_and_shows_nothing_when_a_retry_succeeds", async () => {
  const { app, connected } = await mountPane([node("a")], [info("t-a")]);
  const calls = refuseOutput(app, 3);

  connected.rail.select("a");
  await subscribed(app, "t-a");
  expect(calls()).toBe(4);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("u6249b_terminal_output_stops_after_the_last_retry_and_its_retry_button_subscribes_again", async () => {
  const { app, connected } = await mountPane([node("a")], [info("t-a")]);
  const calls = refuseOutput(app, 5);

  connected.rail.select("a");
  await screen.findByRole("alert", { name: /^Terminal output stopped\.\s+channel refused$/ });

  expect(calls()).toBe(5);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await subscribed(app, "t-a");
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

it("u6249b_terminal_restore_failure_offers_retry_instead_of_telling_the_user_to_switch_away", async () => {
  const { app, connected, emulators } = await mountPane([node("a")], [info("t-a")]);
  let snapshots = 0;

  app.handlers["terminal.snapshot"] = () => {
    if (++snapshots <= 5) throw new RpcError(-32603, "connection closed");

    return { cols: 100, rows: 30, after: 0, data: "" };
  };

  connected.rail.select("a");
  await screen.findByRole("alert", { name: /^Could not restore Terminal output\.\s+connection closed$/ });

  expect(snapshots).toBe(5);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(emulators.get("t-a")).toBeDefined();
});

it("u6249d_a_terminal_failure_is_dismissed_by_its_button_and_by_escape_inside_the_line", async () => {
  const { app, connected } = await mountPane([node("a")], [info("t-a")]);

  refuseOutput(app, Infinity);
  connected.rail.select("a");
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

  connected.rail.select(null);
  connected.rail.select("a");
  await screen.findByRole("alert");
  fireEvent.keyDown(screen.getByRole("button", { name: "Dismiss" }), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

it("u6249b_attaching_retries_a_preparation_that_fails_and_stops_for_a_cancelled_one", async () => {
  const { connected } = await connectFakeProject([node("a")], [info("t-a")]);
  const { factory } = fakeEmulators();
  let tries = 0;

  const flaky: typeof factory = (id, copy) => {
    const emulator = factory(id, copy);
    const prepare = emulator.prepare!;

    emulator.prepare = (host, settled, signal) => ++tries <= 2 ? Promise.reject(new Error("layout not ready")) : prepare(host, settled, signal);

    return emulator;
  };

  const screens = createScreens(connected, flaky);

  await expect(screens.prepare(document.createElement("div"))).resolves.toHaveProperty("size");
  expect(tries).toBe(3);

  tries = 0;
  const cancel = new AbortController();

  cancel.abort(new Error("cancelled"));
  await expect(screens.prepare(document.createElement("div"), () => true, cancel.signal)).rejects.toThrow("cancelled");
  expect(tries).toBe(0);
  screens.dispose();
  connected.stopTerminalScheme();
});
