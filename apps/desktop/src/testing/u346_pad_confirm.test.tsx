// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { showEverythingInApp } from "./showEverything";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { openPad } from "../pads/padsFixture";
import type { AppSeam } from "../app/seam";
import { fakeEmulators } from "../terminal/paneHarness";
import { showShelfTab } from "./shelfTabs";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

// jsdom has no layout, so the editor's scroll-to-selection asks a Range for rects it cannot give.
Range.prototype.getClientRects ??= () => document.body.getClientRects();

Range.prototype.getBoundingClientRect ??= () => document.body.getBoundingClientRect();

let real: StartedDaemon;

const inFlight = new Set<Promise<unknown>>();

describe("u346 the Pad's confirm delete takes a real click", () => {
  beforeEach(async () => {
    real = await startRealDaemon({});
  }, 120_000);

  afterEach(async () => {
    cleanup();
    await Promise.allSettled(inFlight);
    inFlight.clear();
    // The App's last pad.delete refresh may still be in flight; stopping the daemon under it rejects the fetch unhandled.
    await new Promise((done) => setTimeout(done, 250));
    await real?.stop();
  });

  it("u346_a_pointer_click_on_the_confirm_calls_pad_delete_once_on_the_real_daemon", async () => {
    const app: AppSeam = createServedApp(real.base);
    const served = app.rpc;
    const calls: string[] = [];

    app.rpc = (method, params) => {
      calls.push(method);

      const call = served(method, params);

      // A request the App leaves in flight settles before the Daemon stops, and its late failure is not an unhandled rejection.
      inFlight.add(call);
      call.catch(() => {});

      return call;
    };

    await app.rpc("pad.create", { name: "plan", text: "v1" });
    calls.length = 0;
    await app.rpc("rail.createWorkstream", { name: "scope", parent: null });
    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    await showEverythingInApp(/scope/);

    const shelf = await screen.findByRole("region", { name: "Work items" });

    await screen.findByRole("tablist", { name: "Work items" });
    showShelfTab("Pads");

    const unassigned = await within(shelf).findByRole("button", { name: "Unassigned" });

    if (unassigned.closest('[role="treeitem"]')?.getAttribute("aria-expanded") === "false") fireEvent.click(unassigned);

    fireEvent.click(await within(shelf).findByRole("button", { name: "plan" }));

    const drawer = await screen.findByRole("complementary", { name: "Drawer" });

    fireEvent.click(await within(drawer).findByRole("button", { name: "Delete" }));

    const confirm = (await within(drawer).findAllByRole("button", { name: "Delete" }))[0]!;

    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) fireEvent(confirm, new MouseEvent(type, { bubbles: true, cancelable: true }));

    await waitFor(() => expect(within(shelf).queryByRole("button", { name: "plan" })).toBeNull());
    expect(calls.filter((method) => method === "pad.delete")).toHaveLength(1);
  }, 120_000);
});

it("p2544d_stale_write_without_event_keeps_draft", async () => {
  const { render } = await import("@solidjs/testing-library");
  const { App } = await import("../App");
  const { fakeEmulators } = await import("../terminal/paneHarness");
  const { startRealDaemon } = await import("./realDaemonFixture");
  const { createServedApp } = await import("./realSeam");
  const real = await startRealDaemon({});

  try {
    const served = createServedApp(real.base);
    const calls: { method: string; params: unknown }[] = [];

    // A missed Event is the fault under test; all reads and writes still reach the real Daemon.
    const app: typeof served = {
      ...served,
      subscribe: (listener) => served.subscribe((event) => { if (event.name !== "pad.changed") listener(event); }),
      rpc: (method, params) => {
        calls.push({ method, params });

        return served.rpc(method, params);
      },
      forProject: () => app,
    };

    const home = await served.rpc("rail.createWorkstream", { name: "review", parent: null });

    await served.rpc("pad.create", { name: "notes", text: "original" });
    await served.rpc("pad.move", { name: "notes", home: home.id });
    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    const { showEverythingInApp } = await import("./showEverything");

    await showEverythingInApp(/review/);
    fireEvent.click(await screen.findByRole("tab", { name: "Pads" }));
    const field = await openPad("notes");

    await served.rpc("pad.append", { name: "notes", text: " remote" });
    fireEvent.input(field, { target: { value: "my draft" } });
    fireEvent.focusOut(field);
    await screen.findByText("Use theirs");
    await waitFor(() => expect(screen.queryByText(/pad notes is at revision/)).toBeNull());
    await waitFor(() => expect(calls.filter((call) => call.method === "pad.list").length).toBeGreaterThan(1));
    expect(field.value).toBe("my draft");
    expect(calls.filter((call) => call.method === "pad.write")).toEqual([
      { method: "pad.write", params: { name: "notes", text: "my draft", expectedRevision: 1 } },
    ]);
    expect(await served.rpc("pad.list", null)).toMatchObject([{ text: "original remote", revision: 2 }]);
    await served.rpc("pad.append", { name: "notes", text: " intervening" });
    fireEvent.click(screen.getByText("Keep mine"));
    await waitFor(() => expect(calls.filter((call) => call.method === "pad.list")).toHaveLength(3));
    expect(screen.queryByText(/pad notes is at revision/)).toBeNull();
    expect(calls.filter((call) => call.method === "pad.write").at(-1)?.params).toEqual({
      name: "notes", text: "my draft", expectedRevision: 2,
    });
    expect(field.value).toBe("my draft");
    await new Promise((done) => setTimeout(done, 550));
    expect(calls.filter((call) => call.method === "pad.write")).toHaveLength(2);
    fireEvent.click(screen.getByText("Use theirs"));
    await waitFor(() => expect(field.value).toBe("original remote intervening"));
    expect(screen.queryByText(/pad notes is at revision/)).toBeNull();
    expect(screen.queryByText("Use theirs")).toBeNull();
    fireEvent.input(field, { target: { value: "after choice" } });
    fireEvent.focusOut(field);
    await waitFor(async () => expect(await served.rpc("pad.list", null)).toMatchObject([{ text: "after choice", revision: 4 }]));
    expect(calls.filter((call) => call.method === "pad.read")).toHaveLength(1);
  } finally {
    cleanup();
    await real.stop();
  }
}, 180_000);

it("p2544e_reopen_saved_agent_work", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, rm, mkdir, writeFile } = await import("node:fs/promises");
  const { join, resolve } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { startRealDaemon } = await import("./realDaemonFixture");
  const { createServedApp } = await import("./realSeam");
  const report = await mkdtemp(join(tmpdir(), "p2544e-tool-"));

  const profile = join(report, "browser");
  const execute = promisify(execFile);
  const session = `p2544e-${process.pid}`;
  const browser = async (...args: string[]) => (await execute("agent-browser", ["--session", session, ...args], { timeout: 60_000 })).stdout;
  const evaluate = async (source: string) => JSON.parse(await browser("eval", source));
  const visualSource = 'Agent prose.\n\n```mermaid\ngraph LR\nA-->B\n```\n\n```excalidraw\n{"type":"excalidraw","elements":[]}\n```\n\nTail prose.\n';

  const real = await startRealDaemon({
    FAKE_CLAUDE_RUN: JSON.stringify([[resolve(process.cwd(), "../../target/debug/rup"), "pad", "create", "agent-work", "--text", visualSource]]),
    FAKE_CLAUDE_RUN_REPORT: join(report, "calls.json"),
  }, true);

  try {
    await browser("--profile", profile, "open", "about:blank");
    await browser("set", "viewport", "1512", "950");
    const app = createServedApp(real.base);
    const home = await app.rpc("rail.createWorkstream", { name: "Pad review", parent: null });

    const agent = await app.rpc("agent.spawn", {
      cwd: real.dir, parent: home.id, prompt: null,
      order: { kind: "work", ask: "Produce the review Pad", limits: [] },
    });

    await expect.poll(() => app.rpc("pad.list", null), { timeout: 30_000 }).toMatchObject([
      { name: "agent-work", owner: { kind: "agent", id: agent.id }, home: home.id, text: visualSource, revision: 1 },
    ]);

    const openRealPad = async () => {
      await browser("open", `${real.base}/harness.html?daemon=1`);
      await browser("wait", `[data-id='${home.id}'] [data-part=branch-control]`);
      await browser("click", `[data-id='${home.id}'] [data-part=branch-control]`);

      if (await evaluate("document.querySelector('#shelf-tab-pads').getAttribute('aria-expanded')") !== "true") await browser("click", "#shelf-tab-pads");
      await browser("wait", "[data-shelf-row] .pad-name");
      await browser("click", "[data-shelf-row] .pad-name");
      await browser("wait", ".ProseMirror[role=textbox]");
      // DrawerHost and styles.css's Shelf transitions finish independently before the next pointer input.
      // Readiness comes after the lazy editor mounts, so its layout participates in the settled frame.
      await evaluate(`(async () => {
        await Promise.all(document.getAnimations()
          .filter(animation => animation.effect.getComputedTiming().iterations !== Infinity)
          .map(animation => animation.finished));
        return true;
      })()`);
    };

    await openRealPad();
    expect(await evaluate("document.querySelector('.ProseMirror').getAttribute('contenteditable')")).toBe("false");
    // Native keyboard activation keeps the ownership handoff independent of the lazy visual blocks' layout.
    await browser("focus", ".pad-head button[aria-label='Make yours']");
    await browser("press", "Enter");
    await browser("wait", ".ProseMirror[contenteditable=true]");
    await browser("focus", ".ProseMirror");
    await browser("press", "Control+Home");
    await browser("keyboard", "type", "Reviewed ");
    await browser("wait", "[data-state=saved]");
    const expected = `Reviewed ${visualSource}`;

    expect(await app.rpc("pad.read", { name: "agent-work" })).toMatchObject({ text: expected, revision: 2, owner: { kind: "user" } });
    await browser("click", ".drawer .close");
    await real.restart();
    await openRealPad();
    await browser("wait", ".visual-mermaid svg");
    await browser("wait", ".visual-drawing .excalidraw");
    expect(await evaluate("document.querySelector('.ProseMirror p')?.textContent")).toBe("Reviewed Agent prose.");
    expect(await app.rpc("pad.read", { name: "agent-work" })).toMatchObject({ text: expected, revision: 2, home: home.id });
    const evidence = process.env.ROUNDUP_PAD_EVIDENCE;

    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await browser("screenshot", join(evidence, "real-daemon-reopened.png"));
      await writeFile(join(evidence, "real-daemon-reopened.json"), JSON.stringify({
        agent: agent.id, workstream: home.id,
        pad: await app.rpc("pad.read", { name: "agent-work" }),
        checks: await evaluate("window.__checks()"), native_claim: false,
      }));
    }
  } finally {
    try {
      await browser("close");
    } finally {
      try { await real.stop(); } finally { await rm(report, { recursive: true, force: true }); }
    }
  }
}, 300_000);
