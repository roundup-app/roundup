import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FetchedMain } from "@contracts/agent/FetchedMain";
import type { RemoteMain } from "@contracts/agent/RemoteMain";
import { RpcError } from "../app/seam";
import { copy } from "./copy";
import { mountControl } from "./harness";
import { COMPARISON, openChanges, openFile } from "./noteHarness";

class IdleObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }

beforeEach(() => { vi.stubGlobal("IntersectionObserver", IdleObserver); });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A call the test answers by hand, when it chooses. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });

  return { promise, resolve, reject };
};

/** The view open on Agent `a` over a fake App whose two new methods answer as the test says. */
const open = async (remote: () => Promise<RemoteMain>, fetch: () => Promise<FetchedMain> = () => Promise.resolve({ commits: 0 })) => {
  const mounted = await mountControl();

  mounted.app.handlers["agent.remoteMain"] = remote;
  mounted.app.handlers["agent.fetchRemoteMain"] = fetch;
  mounted.app.handlers["agent.compareFile"] = ({ path }) => ({ ...COMPARISON, oldPath: path, newPath: path });
  await openChanges();
  await openFile();

  return mounted;
};


it("u7693c_opening_reads_once_waits_for_no_key_and_a_late_answer_never_crosses_agents", async () => {
  const first = deferred<RemoteMain>();
  const mounted = await open(() => first.promise);

  await waitFor(() => expect(mounted.calls("agent.remoteMain")).toBe(1));
  // The read is still pending, and a key moves on.
  const shown = () => document.querySelector(".diff-path")?.textContent;
  const was = shown();

  const region = screen.getByRole("region", { name: copy.changes });

  // J steps to the next file, K to the previous: one of them has a file to move to.
  fireEvent.keyDown(region, { key: "j" });
  await new Promise(resolve => setTimeout(resolve, 50));

  if (shown() === was) fireEvent.keyDown(region, { key: "k" });
  await waitFor(() => expect(shown()).not.toBe(was));
  // The view for another Agent reads for itself; the first Agent's late answer never shows there.
  const second = deferred<RemoteMain>();

  mounted.app.handlers["agent.remoteMain"] = () => second.promise;
  mounted.connected.rail.select("plain");
  void mounted.connected.owned.refresh("plain");
  await waitFor(() => expect(mounted.calls("agent.remoteMain")).toBe(2));
  first.resolve({ kind: "moved" });
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(screen.queryByText(copy.remoteMoved)).toBeNull();
  second.resolve({ kind: "current" });
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(screen.queryByText(copy.remoteMoved)).toBeNull();
});

it("u7693c_the_chip_draws_each_state_in_plain_words", async () => {
  const read = deferred<RemoteMain>();
  const fetch = deferred<FetchedMain>();
  // The chip's 150 ms wait is queued and fired by hand, so a slow open cannot cross the bound.
  const realSetTimeout = globalThis.setTimeout;
  const waits: Array<() => void> = [];

  // SAFETY: the stub takes the (callback, delay) call the code under test makes; Node's `promisify` overload is never used.
  vi.stubGlobal("setTimeout", ((run: () => void, ms?: number, ...rest: unknown[]) => {
    if (ms !== 150) return realSetTimeout(run, ms, ...rest);

    waits.push(run);

    return 0;
  }) as typeof setTimeout);
  const mounted = await open(() => read.promise, () => fetch.promise);

  expect(waits.length).toBeGreaterThan(0);
  expect(screen.queryByText(copy.checkingRemote)).toBeNull();
  waits.forEach(run => run());
  await screen.findByText(copy.checkingRemote);
  read.resolve({ kind: "moved" });
  await screen.findByText(copy.remoteMoved);
  fireEvent.click(screen.getByRole("button", { name: copy.fetch }));
  await screen.findByText(copy.fetching);
  expect(screen.queryByRole("button", { name: copy.fetch })).toBeNull();
  fetch.resolve({ commits: 2 });
  await screen.findByText(copy.fetched(2));
  expect(screen.queryByRole("button", { name: copy.fetch })).toBeNull();
  expect(mounted.calls("agent.fetchRemoteMain")).toBe(1);
});

it("u7693c_a_failed_read_shows_its_cause_and_retry_repeats_the_call_that_failed", async () => {
  let reachable = false;
  // The connection retries a failed read by itself, so the remote fails every time until the test lets it answer.
  const mounted = await open(() => reachable ? Promise.resolve({ kind: "moved" }) : Promise.reject(new RpcError(-32603, "remote_unreachable: ssh: Could not resolve hostname origin.example")));

  await screen.findByText(copy.remoteUnreachable, { exact: false });
  await screen.findByText("ssh: Could not resolve hostname origin.example", { exact: false });
  const reads = mounted.calls("agent.remoteMain");

  reachable = true;
  fireEvent.click(screen.getByRole("button", { name: copy.retry }));
  await screen.findByText(copy.remoteMoved);
  expect(mounted.calls("agent.remoteMain")).toBeGreaterThan(reads);
  expect(mounted.calls("agent.fetchRemoteMain")).toBe(0);
});

it("u7693c_current_and_none_show_no_chip", async () => {
  for (const kind of ["current", "none"] as const) {
    const mounted = await open(() => Promise.resolve({ kind }));

    await waitFor(() => expect(mounted.calls("agent.remoteMain")).toBe(1));
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(screen.queryByRole("button", { name: copy.fetch })).toBeNull();
    expect(screen.queryByText(copy.checkingRemote)).toBeNull();
    cleanup();
  }
});

it("u7693c_only_the_click_fetches_and_opening_reads_once", async () => {
  const mounted = await open(() => Promise.resolve({ kind: "moved" }));

  await screen.findByText(copy.remoteMoved);
  vi.useFakeTimers();
  // A key, an Agent's write refresh and ten minutes of timers fetch nothing and read nothing again.
  fireEvent.keyDown(screen.getByRole("region", { name: copy.changes }), { key: "j" });
  await mounted.connected.owned.refresh("a");
  await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
  expect(mounted.calls("agent.fetchRemoteMain")).toBe(0);
  expect(mounted.calls("agent.remoteMain")).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: copy.fetch }));
  await vi.advanceTimersByTimeAsync(10);
  expect(mounted.calls("agent.fetchRemoteMain")).toBe(1);
});

it("u7693c_a_fetch_lists_again_and_reads_the_open_file_once", async () => {
  const mounted = await open(() => Promise.resolve({ kind: "moved" }), () => Promise.resolve({ commits: 1 }));

  await screen.findByText(copy.remoteMoved);
  const before = { listed: mounted.calls("agent.ownedChanges"), read: mounted.calls("agent.compareFile") };

  fireEvent.click(screen.getByRole("button", { name: copy.fetch }));
  await screen.findByText(copy.fetched(1));
  await waitFor(() => expect(mounted.calls("agent.compareFile")).toBe(before.read + 1));
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(mounted.calls("agent.compareFile")).toBe(before.read + 1);
  expect(mounted.calls("agent.ownedChanges")).toBe(before.listed + 1);
});

it("u7693c_fetch_is_reachable_by_tab", async () => {
  await open(() => Promise.resolve({ kind: "moved" }));
  await screen.findByText(copy.remoteMoved);
  const user = userEvent.setup();

  screen.getByRole("region", { name: copy.changes }).focus();

  for (let step = 0; step < 12 && document.activeElement !== screen.getByRole("button", { name: copy.fetch }); step += 1) await user.tab();

  expect(document.activeElement).toBe(screen.getByRole("button", { name: copy.fetch }));
});
