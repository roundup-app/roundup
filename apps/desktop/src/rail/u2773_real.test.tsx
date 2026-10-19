// @vitest-environment jsdom
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { App } from "../App";
import { fakeEmulators } from "../terminal/paneHarness";
import { chromePath } from "../testing/chromePage";
import { startRealDaemon, type StartedDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";

let first: StartedDaemon;

let second: StartedDaemon;

beforeAll(async () => {
  first = await startRealDaemon({}, true);
  second = await startRealDaemon({});
}, 180_000);

afterAll(async () => { await second?.stop(); await first?.stop(); });

afterEach(() => { cleanup(); localStorage.clear(); });

const open = () => fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });

const task = () => screen.getByLabelText<HTMLTextAreaElement>("Task");

it("u2773b_rail_real_acknowledgement_consumes_only_submitted_revision", async () => {
  const app = createServedApp(second.base);
  const before = (await app.rpc("rail.tree", null)).filter((node) => node.kind === "agent").length;
  const starts: string[] = [];
  const rpc = app.rpc;
  app.rpc = (method, params) => {
    if (method === "agent.spawn") starts.push(JSON.stringify(params));

    return rpc(method, params);
  };

  const mount = async () => {
    render(() => <App app={app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    await waitFor(() => expect(document.querySelector(".rail-tree")).not.toBeNull());
  };

  await mount();
  open();
  fireEvent.input(task(), { target: { value: " B\n😀 " } });
  fireEvent.keyDown(task(), { key: "Enter" });
  await waitFor(() => expect(screen.queryByLabelText("Task")).toBeNull());
  expect((await app.rpc("rail.tree", null)).filter((node) => node.kind === "agent")).toHaveLength(before + 1);
  expect(starts).toEqual([JSON.stringify({ cwd: second.dir, prompt: "B\n😀", parent: null, model: null, effort: null })]);
  cleanup();
  await mount();
  open();
  expect(task().value).toBe("");
  expect(starts).toHaveLength(1);
}, 120_000);

it("u2773a_rail_webview_reload_restores_without_replaying_spawn", async () => {
  const execute = promisify(execFile);
  const executable = chromePath();

  if (!executable) throw new Error("U2773 needs an isolated Chrome binary");
  const profile = await mkdtemp(join(tmpdir(), "u2773-rail-browser-"));
  const config = join(profile, "config.json");
  await writeFile(config, "{}");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));

  const browser = async (...args: string[]) => {
    const { stdout } = await execute("agent-browser", ["--executable-path", executable, "--args", "--no-sandbox", "--config", config, "--session", `u2773-rail-${process.pid}`, "--profile", profile, "--json", ...args], { env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const reply = JSON.parse(stdout);
    expect(reply.success, stdout).toBe(true);

    return reply.data;
  };

  const app = createServedApp(first.base);

  for (let count = (await app.rpc("rail.tree", null)).length; count < 40; count += 1) {
    await app.rpc("rail.createWorkstream", { name: `Work ${count}`, parent: null });
  }

  const before = await app.rpc("rail.tree", null);

  try {
    await browser("open", `${first.base}/harness.html?daemon=1`);
    await browser("set", "viewport", "1512", "950");
    await browser("wait", "--fn", "!!document.querySelector('.rail-tree')");
    await writeFile("/tmp/u2773-rail-before-checks.json", JSON.stringify((await browser("eval", "window.__checks()")).result, null, 2));
    await browser("screenshot", "/tmp/u2773-rail-before.png");
    await browser("eval", "document.dispatchEvent(new KeyboardEvent('keydown',{key:'n',metaKey:true,shiftKey:true,bubbles:true}))");
    await browser("wait", "--fn", "!!document.querySelector('[aria-label=Task]')");
    await browser("fill", '[aria-label="Task"]', " exact\né 😀 ");
    await browser("reload");
    await browser("wait", "--fn", "!!document.querySelector('.rail-tree')");
    expect((await browser("eval", "document.querySelector('[aria-label=Task]') === null")).result).toBe(true);
    await browser("eval", "document.dispatchEvent(new KeyboardEvent('keydown',{key:'n',metaKey:true,shiftKey:true,bubbles:true}))");
    await browser("wait", "--fn", "!!document.querySelector('[aria-label=Task]')");
    expect((await browser("eval", "document.querySelector('[aria-label=Task]').value")).result).toBe(" exact\né 😀 ");
    expect(await app.rpc("rail.tree", null)).toEqual(before);
    await browser("screenshot", "/tmp/u2773-rail-restored.png");
    await browser("eval", "document.querySelector('[aria-label=Task]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await browser("eval", `document.querySelector('.rail-row[data-id="${before[0]!.id}"] .name').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
    await browser("fill", '[aria-label="Name"]', " exact name 😀 ");
    await app.rpc("rail.rename", { id: before[0]!.id, name: "Changed elsewhere" });
    await browser("wait", "--fn", "!!document.querySelector('[role=alert]')");
    await browser("screenshot", "/tmp/u2773-rail-conflict.png");
    await writeFile("/tmp/u2773-rail-conflict-checks.json", JSON.stringify((await browser("eval", "window.__checks()")).result, null, 2));
    await browser("eval", "document.querySelector('[aria-label=Name]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); document.querySelector('.todo-project-root').click(); document.dispatchEvent(new KeyboardEvent('keydown',{key:'n',metaKey:true,shiftKey:true,bubbles:true}))");
    await browser("wait", "--fn", "!!document.querySelector('[aria-label=Task]')");
    await browser("eval", "Storage.prototype.setItem=function(){throw new Error('full')}");
    await browser("fill", '[aria-label="Task"]', " recoverable\n😀 ");
    expect((await browser("eval", "document.querySelector('[role=alert]').textContent")).result).toContain(first.dir);
    await browser("screenshot", "/tmp/u2773-rail-storage-failure.png");
    await writeFile("/tmp/u2773-rail-checks.json", JSON.stringify((await browser("eval", "window.__checks()")).result, null, 2));
  } finally {
    await browser("close");
    await rm(profile, { recursive: true, force: true });
  }
}, 180_000);

it("u2773c_rail_real_external_rename_and_removal_keep_original_edit", async () => {
  const app = createServedApp(first.base);
  const node = await app.rpc("rail.createWorkstream", { name: "Original target", parent: null });
  render(() => <App app={app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
  fireEvent.dblClick(await screen.findByText("Original target", { selector: ".rail-row .name" }));
  const name = screen.getByLabelText<HTMLInputElement>("Name");
  fireEvent.input(name, { target: { value: " exact e\u0301 😀 " } });
  await app.rpc("rail.rename", { id: node.id, name: "Changed elsewhere" });
  expect((await screen.findByRole("alert")).tabIndex).toBe(-1);
  expect(name.value).toBe(" exact e\u0301 😀 ");
  fireEvent.keyDown(name, { key: "Enter" });
  expect((await app.rpc("rail.tree", null)).find((entry) => entry.id === node.id)?.name).toBe("Changed elsewhere");
  await app.rpc("rail.remove", { id: node.id });
  await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull());
  expect(screen.getAllByLabelText<HTMLTextAreaElement>("Recovered rail draft").map((field) => field.value)).toContain(" exact e\u0301 😀 ");
  expect(document.body.textContent).toContain(node.id);
  expect(document.body.textContent).toContain("unavailable");
}, 120_000);

it("u2773a_rail_real_names_keep_original_project_and_object_on_reopen", async () => {
  const one = await startRealDaemon({});
  const two = await startRealDaemon({});

  try {
    const records = [];

    for (const [index, real] of [one, two].entries()) {
      const app = createServedApp(real.base);

      if (index === 1) await app.rpc("rail.createWorkstream", { name: "Spacer", parent: null });
      const target = await app.rpc("rail.createWorkstream", { name: "Same name", parent: null });
      render(() => <App app={app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
      fireEvent.dblClick(await screen.findByText("Same name", { selector: ".rail-row .name" }));
      fireEvent.input(screen.getByLabelText("Name"), { target: { value: ` exact ${index} e\u0301 😀 ` } });
      records.push({ app, target, text: ` exact ${index} e\u0301 😀 ` });
      cleanup();
    }

    expect(records[0]!.target.id).not.toBe(records[1]!.target.id);

    for (const { app, target, text } of records) {
      const renames: string[] = [];
      const rpc = app.rpc;
      app.rpc = (method, params) => {
        if (method === "rail.rename") renames.push(JSON.stringify(params));

        return rpc(method, params);
      };

      render(() => <App app={app} reducedMotion={() => true} clock={Date.now} createEmulator={fakeEmulators().factory} />);
      fireEvent.dblClick(await screen.findByText("Same name", { selector: ".rail-row .name" }));
      expect(screen.getByLabelText<HTMLInputElement>("Name").value).toBe(text);
      expect(renames).toEqual([]);
      fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter" });
      await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull());
      expect((await app.rpc("rail.tree", null)).find((node) => node.id === target.id)?.name).toBe(text.trim());
      expect(renames).toEqual([JSON.stringify({ id: target.id, name: text.trim() })]);
      cleanup();
    }
  } finally {
    cleanup();
    await two.stop();
    await one.stop();
  }
}, 120_000);
