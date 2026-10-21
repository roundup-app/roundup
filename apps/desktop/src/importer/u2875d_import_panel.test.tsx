import { openLane } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "@solidjs/testing-library";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { Rail } from "../rail/Rail";
import { RpcError } from "../app/seam";
import { connectFakeProject } from "../terminal/paneHarness";
import { workstream } from "../testing/nodes";
import { createFakeApp } from "../testing/fakeApp";

afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

const candidates = [
  { source: "s1", title: "first", cwd: "", last_activity_ms: 2n, revision: "r1" },
  { source: "s2", title: "second", cwd: "sub", last_activity_ms: 1n, revision: "r2" },
];

const mount = async () => {
  const { app, connected } = await connectFakeProject([workstream("ws", { name: "ws" })]);
  app.handlers["project.importDiscover"] = () => ({ candidates, excluded: [] });

  app.handlers["project.importCommit"] = (params) => ({
    outcomes: params.selections.map((entry) => ({ source: entry.source, workstream: `w-${entry.source}`, agent: `a-${entry.source}`, error: null })),
  });

  render(() => <ConnectedProjectContext.Provider value={connected}><Rail /></ConnectedProjectContext.Provider>);

  return { app, connected };
};

const calls = (app: Awaited<ReturnType<typeof mount>>["app"], method: string) => app.calls.filter((call) => call.method === method);

const isChecked = (name: RegExp): boolean => {
  const box = screen.getByRole("checkbox", { name });

  return box instanceof HTMLInputElement && box.checked;
};

const open = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: /first/ })).toBeTruthy());
};

it("u2875d_dialog_focus_and_escape_return_to_the_rail", async () => {
  await mount();
  const opener = screen.getByRole("button", { name: "Import Claude Code work" });

  await open();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("dialog")));
  fireEvent.keyDown(document.activeElement ?? document.body, { code: "Escape", key: "Escape", keyCode: 27 });
  await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

it("u2875d_period_change_clears_selection", async () => {
  const { app } = await mount();

  await open();
  fireEvent.click(screen.getByText("first"));
  await screen.findByRole("button", { name: "Import 1" });
  expect(isChecked(/first/)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Last month" }));
  await waitFor(() => expect(calls(app, "project.importDiscover")).toHaveLength(2));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: /first/ })).toBeTruthy());
  await waitFor(() => expect(isChecked(/first/)).toBe(false));
  expect(screen.getByRole("button", { name: "Import" })).toHaveProperty("disabled", true);
});

it.each([new RpcError(-32003, "daemon said no"), new Error("daemon said no")])("u2875d_rejected_call_keeps_period_and_selection (%s)", async (failure) => {
  const { app, connected } = await mount();

  app.handlers["project.importCommit"] = () => { throw failure; };

  await open();
  fireEvent.click(screen.getByRole("button", { name: "Last month" }));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: /first/ })).toBeTruthy());
  fireEvent.click(screen.getByText("first"));
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  await waitFor(() => expect(screen.getByText("daemon said no")).toBeTruthy());
  expect(connected.drafts.list().find((draft) => draft.destination.surface === "import")?.status).toBe(failure instanceof RpcError ? "failed" : "unknown");
  cleanup();
  render(() => <ConnectedProjectContext.Provider value={connected}><Rail /></ConnectedProjectContext.Provider>);
  await open();
  expect(calls(app, "project.importCommit")).toHaveLength(1);
  expect(isChecked(/first/)).toBe(true);
  expect(screen.getByRole("button", { name: "Last month" }).getAttribute("aria-pressed")).toBe("true");
});

it("u2875a_discovery_exclusions_remain_visible_after_partial_failure", async () => {
  const { app } = await mount();
  app.handlers["project.importCommit"] = () => {
    app.handlers["project.importDiscover"] = () => ({ candidates: [candidates[1]!], excluded: [{ source: "s1", reason: "source unavailable" }] });

    return { outcomes: [{ source: "s1", workstream: null, agent: null, error: "copy refused" }] };
  };

  await open();
  fireEvent.click(screen.getByText("first"));
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  await waitFor(() => expect(screen.getByText("source unavailable")).toBeTruthy());
  expect(screen.getByText("copy refused")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
});

it.each([false, true])("u2875d_cancel_consumes_only_the_current_draft (empty: %s)", async (empty) => {
  const { app, connected } = await mount();

  app.handlers["project.importCommit"] = () => { throw new RpcError(-32003, "daemon said no"); };

  await open();
  fireEvent.click(screen.getByText("first"));
  fireEvent.click(await screen.findByRole("button", { name: "Import 1" }));
  await waitFor(() => expect(screen.getByText("daemon said no")).toBeTruthy());
  fireEvent.click(screen.getByText("second"));
  await screen.findByRole("button", { name: "Import 2" });

  if (empty) {
    fireEvent.click(screen.getByText("first"));
    await screen.findByRole("button", { name: "Import 1" });
    fireEvent.click(screen.getByText("second"));
    await screen.findByRole("button", { name: "Import" });
  }

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());
  cleanup();
  render(() => <ConnectedProjectContext.Provider value={connected}><Rail /></ConnectedProjectContext.Provider>);
  await open();
  expect(isChecked(/first/)).toBe(true);
  expect(isChecked(/second/)).toBe(false);
  expect(calls(app, "project.importCommit")).toHaveLength(1);
});


it.skipIf(!captureDir("U3049a"))("u3049a_u3049b_rendered_conflict_recovery", async () => {
  const lane = await openLane(1512, "dark", "builder-3049");

  try {
    await lane.evaluate(`(() => {
      window.__fake.app.handlers['project.importDiscover'] = () => ({ candidates: Array.from({ length: 10 }, (_, at) => ({ source: 's' + (at + 1), revision: 'preview-' + (at + 1), title: ('長い会話 🪁 ' + (at + 1) + ' ').repeat(12), cwd: 'src', last_activity_ms: 1n })), excluded: [] });
      return true;
    })()`);
    await lane.browser("click", ".rail-import");
    await lane.until("document.querySelectorAll('.import-check').length === 10");
    await lane.capture("U3049a", "before");
    await lane.browser("click", ".import-list li:first-child .import-check");
    await lane.until("document.querySelector('.import-confirm')?.textContent === 'Import 1'");
    await lane.evaluate(`(() => {
      localStorage.setItem('roundup:import:/Users/you/harness', JSON.stringify({ open: true, period: 'month', selected: [{ source: 's2', revision: 'preview-2', title: ('長い会話 🪁 2 ').repeat(12) }] }));
      document.querySelectorAll('.import-check')[2].click();
      return true;
    })()`);
    await lane.until("!!document.querySelector('.import-recovery [role=status]')");
    await lane.capture("U3049a", "conflict");
    expect(await lane.calls("project.importCommit")).toEqual([]);
    await lane.browser("focus", ".import-recovery button");
    await lane.browser("press", "Enter");
    await lane.until("document.querySelector('.import-confirm')?.disabled && document.querySelector('.import-confirm')?.textContent === 'Import 1'");
    await lane.capture("U3049b", "recovered");
    await lane.evaluate(`(() => {
      const read = Storage.prototype.getItem;
      Storage.prototype.getItem = function(key) { if (key === 'roundup:import:/Users/you/harness') throw new Error('unreadable'); return read.call(this, key); };
      document.querySelector('.import-recovery button').click();
      return true;
    })()`);
    await lane.until("document.querySelector('.import-panel').textContent.includes('could not be restored')");
    await lane.browser("scrollintoview", ".import-panel [role=alert]");
    await lane.capture("U3049b", "retention-failure");
    expect(await lane.calls("project.importCommit")).toEqual([]);
  } finally {
    await lane.close();
  }
}, 120_000);

it("u3037d_discovery_deadline_and_retry", async () => {
  const { app } = await mount();
  app.handlers["project.importDiscover"] = () => new Promise(() => {});
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
  await vi.advanceTimersByTimeAsync(0);
  expect(within(screen.getByRole("dialog")).getByRole("status")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", false);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(within(screen.getByRole("dialog")).queryByRole("status")).toBeNull();
  expect(calls(app, "project.importCommit")).toHaveLength(0);
  app.handlers["project.importDiscover"] = () => ({ candidates, excluded: [] });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await vi.advanceTimersByTimeAsync(0);
  expect(screen.getByRole("checkbox", { name: /first/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Import" })).toHaveProperty("disabled", true);
});


it.each(["timeout", "period", "dismiss", "project"])("u3037d_late_results_cannot_replace_current_state (%s)", async (action) => {
  const { app } = await mount();
  let complete: (result: { candidates: typeof candidates; excluded: [] }) => void = () => {};

  app.handlers["project.importDiscover"] = () => new Promise((resolve) => { complete = resolve; });
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
  await vi.advanceTimersByTimeAsync(0);
  app.handlers["project.importDiscover"] = () => { throw new Error("current failure"); };

  if (action === "timeout") await vi.advanceTimersByTimeAsync(20_000);
  else if (action === "period") {
    fireEvent.click(screen.getByRole("button", { name: "Last day" }));
    await vi.advanceTimersByTimeAsync(0);
  } else if (action === "dismiss") fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  else {
    cleanup();
    const other = createFakeApp();
    other.handlers["rail.tree"] = () => [];
    other.handlers["terminal.list"] = () => [];
    other.handlers["project.importDiscover"] = () => { throw new Error("current failure"); };

    const connected = await connectProject(other, { name: "q", path: "/q" }, () => false, () => 0, () => null);
    render(() => <ConnectedProjectContext.Provider value={connected}><Rail /></ConnectedProjectContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Import Claude Code work" }));
    await vi.advanceTimersByTimeAsync(0);
  }

  complete({ candidates, excluded: [] });
  await vi.advanceTimersByTimeAsync(0);
  expect(screen.queryByRole("checkbox", { name: /first/ })).toBeNull();

  if (action !== "dismiss") expect(within(screen.getByRole("dialog")).getByRole("alert")).toBeTruthy();
  expect(calls(app, "project.importCommit")).toHaveLength(0);
});
