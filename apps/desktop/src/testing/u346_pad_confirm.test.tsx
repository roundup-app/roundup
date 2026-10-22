// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { showEverythingInApp } from "./showEverything";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { USER } from "./nodes";
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

    const pad = await served.rpc("pad.create", { name: "notes", text: "original" });
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
      { method: "pad.write", params: { name: "notes", text: "my draft", expectedRevision: 1, expectedIncarnation: pad.incarnation } },
    ]);
    expect(await served.rpc("pad.list", null)).toMatchObject([{ text: "original remote", revision: 2 }]);
    await served.rpc("pad.append", { name: "notes", text: " intervening" });
    fireEvent.click(screen.getByText("Keep mine"));
    await waitFor(() => expect(calls.filter((call) => call.method === "pad.list")).toHaveLength(3));
    expect(screen.queryByText(/pad notes is at revision/)).toBeNull();
    expect(calls.filter((call) => call.method === "pad.write").at(-1)?.params).toEqual({
      name: "notes", text: "my draft", expectedRevision: 2, expectedIncarnation: pad.incarnation,
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
    // Ownership is the subject here; keyboard activation cannot miss the control while lazy visuals change layout.
    await browser("focus", ".pad-head .pad-make-yours");
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

it("u2773a_pads_restores_exact_work_through_App_and_real_Daemon", async () => {
  const [{ startRealDaemon }, { createServedApp }, { App }, { createProjectDrafts }, { fakeEmulators }, { showEverythingInApp }, { showShelfTab }, { render }] = await Promise.all([
    import("./realDaemonFixture"), import("./realSeam"), import("../App"), import("../state/connectedProject"), import("../terminal/paneHarness"), import("./showEverything"), import("./shelfTabs"), import("@solidjs/testing-library"),
  ]);

  const first = await startRealDaemon({});
  const second = await startRealDaemon({});

  try {
    let one = createServedApp(first.base);
    let two = createServedApp(second.base);
    const name = "retained-real";
    const original = await one.rpc("pad.create", { name, text: "original\n" });
    const other = await two.rpc("pad.create", { name, text: "other Project\n" });
    await one.rpc("rail.createWorkstream", { name: "scope-first", parent: null });
    await two.rpc("rail.createWorkstream", { name: "scope-second", parent: null });
    let paths = [first.dir];
    const closed = new Set<string>();
    const calls = [vi.spyOn(one, "rpc"), vi.spyOn(two, "rpc")];

    const app = {
      ...one,
      projects: async () => paths.map(path => ({ path, name: path === first.dir ? "first" : "second", running: true })),
      forProject: (path: string) => path === first.dir ? one : two,
      chooseProjectPath: async () => paths.includes(second.dir) ? first.dir : second.dir,
      openProject: async (path: string) => {
        if (closed.delete(path)) {
          const root = path === first.dir ? first : second;
          await root.restart();
          const bound = createServedApp(root.base);
          calls.push(vi.spyOn(bound, "rpc"));

          if (path === first.dir) one = bound;
          else two = bound;
        }

        if (!paths.includes(path)) paths.push(path);

        return { path, name: path === first.dir ? "first" : "second" };
      },
      closeProject: async (path: string) => {
        (path === first.dir ? first : second).daemon.kill();
        closed.add(path);
        paths = paths.filter(each => each !== path);
      },
      onDaemonExited: async () => () => {},
    };

    let drafts = createProjectDrafts();
    const mount = () => render(() => <App app={app} drafts={drafts} reducedMotion={() => true} clock={() => 0} createEmulator={fakeEmulators().factory} />);
    const writes = () => calls.flatMap(spy => spy.mock.calls).filter(([method]) => method === "pad.write" || method === "pad.create" || method === "pad.move").length;
    mount();
    await showEverythingInApp(/scope-first/);
    showShelfTab("Pads");
    const field = await openPad(name);
    fireEvent.input(field, { target: { value: "unfinished é 🪁\nsecond" } });
    const retained = drafts(first.dir).list().at(-1)!;
    expect(retained.destination).toEqual({ surface: "pads", object: original.incarnation, recipient: null });
    expect(retained.value).toMatchObject({ originalName: name, source: "unfinished é 🪁\nsecond\n", base: "original\n", baseRevision: original.revision });
    // A separate public write generates the real Event that pauses this editor.
    await one.rpc("pad.write", { name, text: "external\n", expectedRevision: original.revision, expectedIncarnation: original.incarnation });
    await screen.findByText(/Changed by/);
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await screen.findByRole("tab", { name: "second" });
    await showEverythingInApp(/scope-second/);
    showShelfTab("Pads");
    const elsewhere = await openPad(name);
    expect(elsewhere.value).toBe("other Project");
    fireEvent.input(elsewhere, { target: { value: "separate 🪁" } });
    await two.rpc("pad.write", { name, text: "external other", expectedRevision: other.revision, expectedIncarnation: other.incarnation });
    await screen.findByText(/Changed by/);
    const afterExternal = writes();
    cleanup();
    // A fresh App and holder read the durable bytes, rather than reusing component memory.
    drafts = createProjectDrafts();
    mount();
    fireEvent.click(await screen.findByRole("tab", { name: "first" }));
    await showEverythingInApp(/scope-first/);
    showShelfTab("Pads");
    const restored = await openPad(name);
    expect(restored.value).toBe("unfinished é 🪁\nsecond");
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
    const focused = document.activeElement;
    await one.rpc("pad.setOwner", { name, owner: USER });
    expect(document.activeElement).toBe(focused);
    fireEvent.focusOut(restored);
    expect(writes()).toBe(afterExternal);
    expect(drafts(first.dir).list().at(-1)?.value.base).toBe("original\n");
    expect(drafts(second.dir).list().at(-1)).toMatchObject({ destination: { object: other.incarnation }, value: { source: "separate 🪁\n", base: "other Project\n" } });
    expect((await one.rpc("pad.read", { name })).text).toBe("external\n");
    expect((await two.rpc("pad.read", { name })).text).toBe("external other");
    const firstTab = document.querySelector<HTMLElement>(`[data-path="${first.dir}"]`)!;
    fireEvent.pointerEnter(firstTab);
    fireEvent.click(within(firstTab).getByRole("button", { name: /^Close / }));
    await waitFor(() => expect(document.querySelector(`[data-path="${first.dir}"]`)).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Open a folder" }));
    await waitFor(() => expect(document.querySelector(`[data-path="${first.dir}"]`)).not.toBeNull());
    await showEverythingInApp(/scope-first/);
    showShelfTab("Pads");
    const reopenedProject = await openPad(name);
    expect(reopenedProject.value).toBe("unfinished é 🪁\nsecond");
    expect(writes()).toBe(afterExternal);
    // Removing and recreating the original cannot lend authority to recovered edits.
    await one.rpc("pad.delete", { name });
    const replacement = await one.rpc("pad.create", { name, text: "replacement" });
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>("button", { name: "Resume" }).disabled).toBe(true));
    expect(replacement.incarnation).not.toBe(original.incarnation);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect((await one.rpc("pad.read", { name })).text).toBe("replacement");
    expect(drafts(first.dir).list().at(-1)?.destination.object).toBe(original.incarnation);
  } finally {
    cleanup();
    vi.restoreAllMocks();
    await first.stop();
    await second.stop();
  }
}, 240_000);
