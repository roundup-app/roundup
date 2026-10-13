import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { captureDir } from "./captures";
import { CHECK_IDS } from "./checks";
import type { Checks } from "./checks";
import { startRealDaemon } from "./realDaemonFixture";
import { createServedApp } from "./realSeam";

const execute = promisify(execFile);

const ART = captureDir("U463");

const observer = async (width: number, input: "keyboard" | "pointer", name: string) => {
  const real = await startRealDaemon({ FAKE_CLAUDE_ON_PROMPT: JSON.stringify({ name: "todo_create", arguments: { title: "$prompt" } }) }, true);
  const profile = await mkdtemp(join(tmpdir(), "u463-browser-"));
  const config = join(profile, "agent-browser-config.json");

  // An empty config excludes personal browser defaults and connections as well as environment overrides.
  await writeFile(config, "{}");
  const session = `u463-${process.pid}-${width}-${input}-${name}`;

  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));

  const browser = async (...args: string[]) => {
    const { stdout } = await execute("agent-browser", ["--config", config, "--session", session, "--profile", profile, "--json", ...args], { env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }).catch((error) => { throw new Error(`${error.message}\n${error.stdout}\n${error.stderr}`); });
    const reply = JSON.parse(stdout);

    expect(reply.success, stdout).toBe(true);

    return reply.data;
  };

  const wait = (expression: string) => browser("wait", "--fn", expression);

  let baseline: Checks | undefined;

  const observe = async (step: string): Promise<Checks> => {
    const checks: Checks = (await browser("eval", "window.__checks()")).result;

    for (const id of CHECK_IDS) if (baseline?.[id].status === "pass") expect(checks[id].status, `${id} at ${step}`).toBe("pass");

    for (const id of ["D2", "D5", "D6"] as const) expect(checks[id].status, `${id} at ${step}`).toBe("pass");
    baseline ??= checks;

    if (ART) {
      await mkdir(ART, { recursive: true });
      const file = `${width}-${input}-${name}-${step}`;

      await browser("screenshot", join(ART, `${file}.png`));
      await writeFile(join(ART, `${file}.checks.json`), JSON.stringify(checks, null, 2));
    }

    return checks;
  };

  const activate = async (selector: string) => {
    if (input === "pointer") await browser("click", selector);
    else {
      await browser("focus", selector);
      await browser("press", "Enter");
    }
  };

  return { real, browser, wait, observe, activate, app: createServedApp(real.base), close: async () => {
    try { await browser("close"); } finally {
      await real.stop();
      await rm(profile, { recursive: true, force: true });
    }
  } };
};

for (const width of [1280, 1440]) for (const input of ["keyboard", "pointer"] as const) {
  it(`u463_first_run_chooses_the_configured_project_and_reaches_its_real_thread ${width} ${input}`, async () => {
    const fixture = await observer(width, input, "choose");
    const { real, browser, wait, observe, activate, app } = fixture;

    try {
      await browser("open", `${real.base}/harness.html?daemon=1&seed=first-run`);
      await browser("set", "viewport", String(width), "800");
      await wait(`document.body.textContent.includes('open a folder to start')`);
      expect((await browser("eval", "document.querySelectorAll('[role=tablist][aria-label=Projects] [role=tab]').length")).result).toBe(0);
      await observe("first-run");
      await browser("eval", `(() => {
        const fetch = window.fetch.bind(window);
        window.__u463Calls = [];
        window.fetch = async (url, options) => {
          const response = await fetch(url, options);
          if (String(url).endsWith('/__daemon/rpc')) window.__u463Calls.push({ ...JSON.parse(options.body), outcome: await response.clone().json() });
          return response;
        };
      })()`);

      await activate('[aria-label="centre"] button');
      await wait(`document.body.textContent.includes('New Workstream')`);

      expect((await browser("eval", "document.querySelector('.project-tab[data-path]').dataset.path")).result).toBe(real.dir);
      await observe("project");
      await activate(".pane-action");
      // U191: creating the Workstream starts its Door once rail.tree acknowledges the row.
      await wait(`window.__u463Calls.some(call => call.method === 'rail.startDoor')`);
      await observe("workstream");
      await wait(`!!document.querySelector('[data-thread-input]') && !!document.querySelector('[role="treeitem"][data-kind="idle"]')`);
      const tree = await app.rpc("rail.tree", null);
      const workstream = tree.find((node) => node.kind === "workstream")!;
      const rendered = (await browser("eval", `({id: document.querySelector('[role="treeitem"][data-id]').dataset.id, terminal: window.__u463Calls.find(call => call.method === 'terminal.snapshot')?.params.id})`)).result;

      expect(rendered.id).toBe(workstream.id);
      expect(rendered.terminal).toBe(workstream.terminal_id);
      expect((await browser("eval", "window.__u463Calls.find(call => call.method === 'rail.startDoor').params.id")).result).toBe(workstream.id);
      expect((await app.rpc("terminal.list", null)).map((terminal) => terminal.id)).toContain(workstream.terminal_id);
      // U371's Shelf floats over the pane, so hide it to expose the pointer's send target.
      await activate('[aria-label="Hide Shelf"]');
      await wait(`document.querySelector('.shelf').hidden`);
      await observe("thread-shelf-closed");
      await browser("fill", "[data-thread-input]", "u463 real request");
      await wait(`!document.querySelector('.thread-send').hasAttribute('aria-disabled')`);

      if (input === "keyboard") await browser("press", "Enter");
      else await browser("click", ".thread-send");
      await wait(`window.__u463Calls.some(call => call.method === 'todo.list' && call.outcome.result?.some(todo => todo.title === 'u463 real request'))`);
      await activate('[aria-label="Show Shelf"]');
      await wait(`document.querySelector('.shelf').getBoundingClientRect().right <= innerWidth`);
      await wait(`[...document.querySelectorAll('[data-todo]')].some(row => row.textContent.includes('u463 real request'))`);
      expect((await app.rpc("message.list", { to: null, status: null })).map((message) => [message.body, message.status, message.to])).toContainEqual(["u463 real request", "delivered", workstream.id]);
      expect((await app.rpc("todo.list", null)).map((todo) => todo.title)).toContain("u463 real request");

      if (ART) await writeFile(join(ART, `${width}-${input}-choose-thread.rpc.json`), JSON.stringify({
        tree,
        terminals: await app.rpc("terminal.list", null),
        messages: await app.rpc("message.list", { to: null, status: null }),
        todos: await app.rpc("todo.list", null),
        calls: (await browser("eval", "window.__u463Calls")).result,
      }, null, 2));
      await observe("thread");

      expect((await browser("eval", "typeof window.__fake")).result).toBe("undefined");
    } catch (error) {
      console.error(JSON.stringify(await browser("eval", "({body: document.body.textContent, calls: window.__u463Calls, draft: document.querySelector('[data-thread-input]')?.value})"), null, 2));
      throw error;
    } finally { await fixture.close(); }
  }, 180_000);

  it(`u463_cancel_keeps_first_run_and_the_next_choice_opens_the_project ${width} ${input}`, async () => {
    const fixture = await observer(width, input, "cancel");
    const { real, browser, wait, observe, activate, app } = fixture;

    try {
      await browser("open", `${real.base}/harness.html?daemon=1&seed=first-run`);
      await browser("set", "viewport", String(width), "800");
      await wait(`document.body.textContent.includes('open a folder to start')`);
      expect((await browser("eval", "document.querySelectorAll('[role=tablist][aria-label=Projects] [role=tab]').length")).result).toBe(0);
      await observe("first-run");

      await browser("eval", "window.__firstRun.cancelNextChoice()");
      await activate('[aria-label="centre"] button');
      // The chooser's null result creates no asynchronous RPC work (state/projects.ts choose).
      expect((await browser("eval", "document.querySelectorAll('[role=tab]').length")).result).toBe(0);
      expect(await app.rpc("rail.tree", null)).toEqual([]);
      expect(await app.rpc("terminal.list", null)).toEqual([]);
      await wait(`document.body.textContent.includes('open a folder to start')`);
      await observe("cancelled");
      await activate('[aria-label="centre"] button');
      await wait(`!!document.querySelector('.pane-action')`);
      expect((await browser("eval", "document.querySelector('.project-tab[data-path]').dataset.path")).result).toBe(real.dir);
      expect(await app.rpc("rail.tree", null)).toEqual([]);
      await observe("retry-project");
    } finally { await fixture.close(); }
  }, 180_000);

  it(`u463_the_first_run_observer_is_opt_in_and_confined_to_its_project ${width} ${input}`, async () => {
    const fixture = await observer(width, input, "boundary");
    const { real, browser, wait, observe, activate, app } = fixture;

    try {
      await browser("open", `${real.base}/harness.html?daemon=1`);
      await browser("set", "viewport", String(width), "800");
      await wait(`!!document.querySelector('.pane-action')`);
      expect((await browser("eval", "typeof window.__firstRun")).result).toBe("undefined");
      expect(await app.chooseProjectPath()).toBeNull();
      expect(await app.chooseSavePath("test.md")).toBeNull();
      await activate('[aria-label="Open a folder"]');
      expect((await browser("eval", "[...document.querySelectorAll('[role=tablist][aria-label=Projects] .project-tab[data-path]')].map(tab => tab.dataset.path)")).result).toEqual([real.dir]);
      await observe("default-project");

      const firstRun = createServedApp(real.base, () => "choose");

      expect(await firstRun.projects()).toEqual([]);
      expect(await firstRun.chooseProjectPath()).toBe(real.dir);
      await expect(firstRun.openProject('/tmp/another-project')).rejects.toMatchObject({ code: -32003 });
      expect(await firstRun.projects()).toEqual([]);
      await firstRun.openProject(real.dir);
      expect((await firstRun.projects())[0]?.path).toBe(real.dir);
      expect(await firstRun.daemonProof()).toBe("0".repeat(64));
    } finally { await fixture.close(); }
  }, 180_000);
}
