// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { openPad } from "../pads/padsFixture";

// jsdom has no layout, so the editor's scroll-to-selection asks a Range for rects it cannot give.
Range.prototype.getClientRects ??= () => document.body.getClientRects();

Range.prototype.getBoundingClientRect ??= () => document.body.getBoundingClientRect();

it("p2544d_stale_write_without_event_keeps_draft", async () => {
  const { render } = await import("@solidjs/testing-library");
  const { RequestedApp: App } = await import("./requestedApp");
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
    fireEvent.click(await screen.findByRole("tab", { name: /^Pads/ }));
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
    ;
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
    await browser("set", "media", "dark");
    const app = createServedApp(real.base);
    const home = await app.rpc("rail.createWorkstream", { name: "Pad review", parent: null });

    const agent = await app.rpc("agent.spawn", {
      cwd: real.dir, parent: home.id, prompt: null,
      order: { kind: "work", ask: "Produce the review Pad", limits: [] },
    });

    await expect.poll(() => app.rpc("pad.list", null), { timeout: 30_000 }).toMatchObject([
      { name: "agent-work", home: home.id, text: visualSource, revision: 1 },
    ]);

    let currentName = "agent-work";

    const openRealPad = async (visit = true) => {
      if (visit) await browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1`);
      await browser("wait", `[data-id='${home.id}'] [data-part=branch-control]`);

      if (await evaluate("document.querySelector('#shelf-tab-pads').getAttribute('aria-expanded')") !== "true") await browser("click", "#shelf-tab-pads");
      await browser("wait", "[data-shelf-row] .pad-name");
      await browser("click", "[data-shelf-row] .pad-name");
      await browser("press", "Enter");
      await browser("wait", ".ProseMirror[role=textbox]");
      // DrawerHost and styles.css's Shelf transitions finish independently before the next pointer input.
      // Readiness comes after the lazy editor mounts, so its layout participates in the settled frame.
      // Overlay thumbs follow a ScrollTimeline; only the wall-clock transitions finish at rest.
      await evaluate(`(async () => {
        await Promise.all(document.getAnimations()
          .filter(animation => animation.timeline === document.timeline && animation.effect.getComputedTiming().iterations !== Infinity)
          .map(animation => animation.finished));
        return true;
      })()`);
    };

    await openRealPad();
    expect(await evaluate("document.querySelector('.ProseMirror').getAttribute('contenteditable')")).toBe("true");
    await browser("focus", ".ProseMirror");
    await browser("press", "Control+Home");
    await browser("keyboard", "type", "Reviewed ");
    await browser("wait", "[data-state=saved]");
    const expected = `Reviewed ${visualSource}`;

    expect(await app.rpc("pad.read", { name: "agent-work" })).toMatchObject({ text: expected, revision: 2 });
    await browser("click", ".drawer .close");
    await browser("wait", "--fn", "!document.querySelector('.pad-body')");
    await browser("focus", ".pad-name");
    await browser("press", "F2");
    await browser("wait", ".row-name-editor input");
    await browser("fill", ".row-name-editor input", "reviewed-work");
    await browser("press", "Enter");
    currentName = "reviewed-work";
    await browser("wait", "--fn", "document.querySelector('.pad-name')?.textContent === 'reviewed-work'");
    const destination = await app.rpc("rail.createWorkstream", { name: "Reviewed", parent: null });
    await app.rpc("pad.move", { name: currentName, home: destination.id });
    await browser("wait", "--fn", `document.querySelector('[data-pad="reviewed-work"]')?.closest('[data-shelf-group]')?.dataset.shelfGroup === ${JSON.stringify(destination.id)}`);
    // The harness's served adapter refuses native close. Embed the same App on its
    // existing seam: the fixture owns the real Daemon's shutdown/restart below.
    await browser("open", `${real.base}/__daemon/open`);
    await evaluate(`(async () => {
      const source = await (await fetch('/src/App.tsx')).text();
      const { render } = await import(source.split('"').find(path => path.includes('/deps/solid-js_web.js')));
      const { App } = await import('/src/App.tsx');
      const { createServedApp } = await import('/src/testing/realSeam.ts');
      const { useBrowserStorage } = await import('/src/state/storage.ts');
      const { runChecks } = await import('/src/testing/checks.ts');
      await Promise.all(['/src/tokens.css', '/src/styles.css', '/src/scrollbar.css'].map(path => import(path)));
      useBrowserStorage(localStorage);
      const served = createServedApp(location.origin);
      const app = { ...served, ask: async () => true, closeProject: async () => {}, chooseProjectPath: async () => ${JSON.stringify(real.dir)} };
      document.body.replaceChildren();
      const root = document.createElement('div');
      document.body.append(root);
      render(() => App({ app, initialShelfOpen: true, reducedMotion: () => true, clock: Date.now }), root);
      window.__checks = () => runChecks();
      return true;
    })()`);
    await browser("wait", `[data-path='${real.dir}']`);
    await browser("click", `[data-path='${real.dir}'] button[aria-label^='Close ']`);
    await browser("wait", "--fn", "!document.querySelector('.project-tab')");
    await real.restart();
    await browser("find", "role", "button", "click", "--name", "Choose folder…", "--exact");
    await openRealPad(false);
    await browser("wait", ".visual-mermaid svg");
    await browser("wait", ".visual-drawing .excalidraw");
    expect(await evaluate("document.querySelector('.ProseMirror p')?.textContent")).toBe(expected.split("\n")[0]);
    expect(await app.rpc("pad.read", { name: currentName })).toMatchObject({ text: expected, revision: 2, home: destination.id });
    const evidence = process.env.ROUNDUP_PAD_EVIDENCE;

    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await browser("screenshot", join(evidence, "real-daemon-reopened.png"));
      await writeFile(join(evidence, "real-daemon-reopened.json"), JSON.stringify({
        agent: agent.id, workstream: home.id,
        pad: await app.rpc("pad.read", { name: currentName }),
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

it("u3789a_generated_App_contract_renames_through_the_real_Daemon", async () => {
  const { startRealDaemon } = await import("./realDaemonFixture");
  const { createServedApp } = await import("./realSeam");
  const real = await startRealDaemon({});

  try {
    const app = createServedApp(real.base);
    const original = await app.rpc("pad.create", { name: "Notes", text: "exact\n text 🌱\n" });
    const home = await app.rpc("rail.createWorkstream", { name: "Home", parent: null });
    await app.rpc("pad.move", { name: original.name, home: home.id });
    await expect(app.rpc("pad.rename", { name: original.name, newName: "Plan", expectedIncarnation: "stale" })).rejects.toMatchObject({ code: -32003 });
    const renamed = await app.rpc("pad.rename", { name: original.name, newName: "Plan", expectedIncarnation: original.incarnation });
    const expected = { ...original, name: "Plan", home: home.id };
    expect(renamed).toEqual(expected);
    await real.restart();
    expect(await createServedApp(real.base).rpc("pad.read", { name: "Plan" })).toEqual(expected);
  } finally {
    await real.stop();
  }
}, 120_000);
