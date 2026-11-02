import type { RailNode } from "@contracts/agent/RailNode";
import { copy as appCopy } from "../app/copy";
import { openLane } from "../todos/laneBrowser";
import type { Todo } from "@contracts/todo/Todo";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { captureDir } from "./captures";
import { chromePath } from "./chromePage";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";
import { createServedApp } from "./realSeam";

const execute = promisify(execFile);

const ART = captureDir("U463");

// E10: the Door's Claude is the pinned one, its model aimock serving these turns.
const DOOR_REQUEST = resolve(process.cwd(), "src/testing/fixtures/u463_door_request.json");

const observer = async (width: number, input: "keyboard" | "pointer", name: string, fixture?: string, running?: StartedDaemon, env: Record<string, string> = {}) => {
  const executable = chromePath();

  if (!executable) throw new Error("U463 needs a Chrome binary: set CHROME_PATH");

  const real = running ?? await startRealDaemon(env, true, undefined, fixture);
  const profile = await mkdtemp(join(tmpdir(), "u463-browser-"));
  const config = join(profile, "agent-browser-config.json");

  // An empty config excludes personal browser defaults and connections as well as environment overrides.
  await writeFile(config, "{}");
  const session = `u463-${process.pid}-${width}-${input}-${name}`;

  const browserEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));

  const browser = async (...args: string[]) => {
    const { stdout } = await execute("agent-browser", ["--executable-path", executable, "--args", "--no-sandbox", "--config", config, "--session", session, "--profile", profile, "--json", ...args], { env: browserEnv, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }).catch((error) => { throw new Error(`${error.message}\n${error.stdout}\n${error.stderr}`); });
    const reply = JSON.parse(stdout);

    expect(reply.success, stdout).toBe(true);

    return reply.data;
  };

  const wait = (expression: string) => browser("wait", "--fn", expression);

  const activate = async (selector: string) => {
    if (input === "pointer") await browser("click", selector);
    else {
      await browser("focus", selector);
      await browser("press", "Enter");
    }
  };

  return { real, browser, wait, activate, app: createServedApp(real.base), close: async () => {
    try { await browser("close"); } finally {
      await real.stop();
      await rm(profile, { recursive: true, force: true }).catch(error => {
        // Chromium cache helpers may finish after close; as in chromePage, leave only this temporary profile to the OS.
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOTEMPTY") throw error;
      });
    }
  } };
};

// One window, 1280 by 800, the narrowest supported.
const width = 1280;

{
  const input = "keyboard";

  it(`u463_first_run_chooses_the_configured_project_and_reaches_its_real_door_terminal ${width} ${input}`, async () => {
    const fixture = await observer(width, input, "choose", DOOR_REQUEST);
    const { real, browser, wait, activate, app } = fixture;

    try {
      await browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1&seed=first-run`);
      await browser("set", "viewport", String(width), "800");
      await wait(`document.body.textContent.includes(${JSON.stringify(appCopy.openAFolderToStart)})`);
      expect((await browser("eval", "document.querySelectorAll('[role=tablist][aria-label=Projects] [role=tab]').length")).result).toBe(0);
      await browser("eval", `(() => {
        const fetch = window.fetch.bind(window);
        window.__u463Calls = [];
        window.fetch = async (url, options) => {
          const response = await fetch(url, options);
          if (String(url).endsWith('/__daemon/rpc')) window.__u463Calls.push({ ...JSON.parse(options.body), outcome: await response.clone().json() });
          return response;
        };
      })()`);

      await activate('[aria-label="Centre"] button');
      await wait(`!!document.querySelector('[aria-label="Create"]')`);

      expect((await browser("eval", "document.querySelector('.project-tab[data-path]').dataset.path")).result).toBe(real.dir);
      await activate('[aria-label="Create"]');
      await browser("press", "ArrowDown");
      await wait("document.querySelector('[role=menuitem][data-highlighted]')?.dataset.value === 'workstream'");
      await browser("press", "Enter");

      // U191: creating the Workstream starts its Door once rail.tree acknowledges the row.
      await wait(`window.__u463Calls.some(call => call.method === 'rail.startDoor')`);
      await wait(`!!document.querySelector('.pane-screen textarea')`);
      const tree = await app.rpc("rail.tree", null);
      const workstream = tree.find((node) => node.kind === "workstream")!;
      await wait(`(async () => {
        const response = await fetch('/__daemon/rpc', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({method:'rail.tree',params:null})});
        return (await response.json()).result?.some(node => node.id === '${workstream.id}' && node.status?.kind === 'idle');
      })()`);
      const rendered = (await browser("eval", `({id: document.querySelector('.rail-row[data-id]').dataset.id, terminal: window.__u463Calls.find(call => call.method === 'terminal.snapshot')?.params.id})`)).result;

      expect(rendered.id).toBe(workstream.id);
      expect(rendered.terminal).toBe(workstream.terminal_id);
      expect((await browser("eval", "window.__u463Calls.find(call => call.method === 'rail.startDoor').params.id")).result).toBe(workstream.id);
      expect((await app.rpc("terminal.list", null)).map((terminal) => terminal.id)).toContain(workstream.terminal_id);
      // U467: the user types to the Door in its own Terminal; the real Claude reads the line as its prompt.
      await browser("click", ".pane-screen");
      await browser("type", ".pane-screen textarea", "u463 real request");
      await browser("press", "Enter");
      await wait(`window.__u463Calls.some(call => call.method === 'terminal.write' && call.params.id === '${workstream.terminal_id}')`);
      await wait(`window.__u463Calls.some(call => call.method === 'todo.list' && call.outcome.result?.some(todo => todo.title === 'u463 real request'))`);
      expect((await app.rpc("message.list", { to: null, status: null })).map((message) => message.body)).not.toContain("u463 real request");
      expect((await app.rpc("todo.list", null)).map((todo) => todo.title)).toContain("u463 real request");
      await real.model!.assertMatched();

      if (ART) await writeFile(join(ART, `${width}-${input}-choose-door.rpc.json`), JSON.stringify({
        tree,
        terminals: await app.rpc("terminal.list", null),
        messages: await app.rpc("message.list", { to: null, status: null }),
        todos: await app.rpc("todo.list", null),
        calls: (await browser("eval", "window.__u463Calls")).result,
      }, null, 2));

      expect((await browser("eval", "typeof window.__fake")).result).toBe("undefined");
    } catch (error) {
      console.error(JSON.stringify(await browser("eval", "({body: document.body.textContent, calls: window.__u463Calls, terminal: document.querySelector('.pane-screen')?.textContent})"), null, 2));
      throw error;
    } finally { await fixture.close(); }
  }, 180_000);
}

// Cancel activates the Centre button the choose test reaches by both inputs, and the
// boundary checks the served seam, not an input path, so both run by keyboard only.
it(`u463_cancel_keeps_first_run_and_the_next_choice_opens_the_project ${width} keyboard`, async () => {
  const fixture = await observer(width, "keyboard", "cancel");
  const { real, browser, wait, activate, app } = fixture;

  try {
    await browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1&seed=first-run`);
    await browser("set", "viewport", String(width), "800");
    await wait(`document.body.textContent.includes(${JSON.stringify(appCopy.openAFolderToStart)})`);
    expect((await browser("eval", "document.querySelectorAll('[role=tablist][aria-label=Projects] [role=tab]').length")).result).toBe(0);

    await browser("eval", "window.__firstRun.cancelNextChoice()");
    await activate('[aria-label="Centre"] button');
    // The chooser's null result creates no asynchronous RPC work (state/projects.ts choose).
    expect((await browser("eval", "document.querySelectorAll('.project-tab [role=tab]').length")).result).toBe(0);
    expect(await app.rpc("rail.tree", null)).toEqual([]);
    expect(await app.rpc("terminal.list", null)).toEqual([]);
    await wait(`document.body.textContent.includes(${JSON.stringify(appCopy.openAFolderToStart)})`);
    await activate('[aria-label="Centre"] button');
    await wait(`!!document.querySelector('[aria-label="Create"]')`);
    expect((await browser("eval", "document.querySelector('.project-tab[data-path]').dataset.path")).result).toBe(real.dir);
    expect(await app.rpc("rail.tree", null)).toEqual([]);
  } finally { await fixture.close(); }
}, 180_000);

it(`u463_the_first_run_observer_is_opt_in_and_confined_to_its_project ${width} keyboard`, async () => {
  const fixture = await observer(width, "keyboard", "boundary");
  const { real, browser, wait, activate, app } = fixture;

  try {
    await browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1`);
    await browser("set", "viewport", String(width), "800");
    await wait(`!!document.querySelector('[aria-label="Create"]')`);
    expect((await browser("eval", "typeof window.__firstRun")).result).toBe("undefined");
    expect(await app.chooseProjectPath()).toBeNull();
    expect(await app.chooseSavePath("test.md")).toBeNull();
    await activate('[aria-label="Open Project"]');
    expect((await browser("eval", "[...document.querySelectorAll('[role=tablist][aria-label=Projects] .project-tab[data-path]')].map(tab => tab.dataset.path)")).result).toEqual([real.dir]);

    const firstRun = createServedApp(real.base, () => "choose");

    expect(await firstRun.projects()).toEqual([]);
    expect(await firstRun.chooseProjectPath()).toBe(real.dir);
    await expect(firstRun.openProject('/tmp/another-project')).rejects.toMatchObject({ code: -32003 });
    expect(await firstRun.projects()).toEqual([]);
    await firstRun.openProject(real.dir);
    expect((await firstRun.projects())[0]?.path).toBe(real.dir);
  } finally { await fixture.close(); }
}, 180_000);

// U2773g composes the category proofs on one real Project; it adds no editor or storage seam.

it("u2875d_real_import_reopen_and_resume", async () => {
  const fixture = await observer(1512, "pointer", "import", undefined, undefined, { FAKE_CLAUDE_LAUNCH_LOG: "/dev/null" });
  const { real, browser, wait, activate, app } = fixture;

  try {
    const recorded = await readFile(resolve(process.cwd(), "../../crates/agents/tests/fixtures/import-2.1.300/top-level.jsonl"), "utf8");
    const stamped = recorded.replaceAll("/fixture/project", real.dir).replace(/"timestamp":"[^"]+"/g, () => `"timestamp":"${new Date().toISOString()}"`);
    const bucket = join(real.dir, "claude-config", "projects", real.dir.replace(/[^a-zA-Z0-9]/g, "-"));

    await mkdir(bucket, { recursive: true });
    await writeFile(join(bucket, "00000001-1111-4111-8111-111111111111.jsonl"), stamped);
    await browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1`);
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await wait("!!document.querySelector('.todo-project-root')");
    await browser("eval", "window.dispatchEvent(new CustomEvent('open-project-page', { detail: { path: document.querySelector('.project-tab[data-selected=true]').dataset.path, command: 'import-work' } }))");
    await wait("!!document.querySelector('.import-check')");
    await activate(".import-check");
    await wait("!document.querySelector('.import-confirm').disabled");
    await activate(".import-confirm");
    await wait("!document.querySelector('.import-panel') && !!document.querySelector('.rail-row[data-id]')");
    const child = (await app.rpc("rail.tree", null)).find((node) => node.kind === "agent")!;
    const parent = (await app.rpc("rail.tree", null)).find((node) => node.id === child.parent)!;

    expect([child.terminal_id, child.attempt, child.status_revision, child.can_resume]).toEqual([null, null, null, true]);
    expect(await app.rpc("terminal.list", null)).toEqual([]);
    await browser("eval", "(async () => { window.__importMenu = (await import('/src/testing/menuProbe.ts')).menuProbe; })()");

    const rightClick = async (id: string) => {
      const point = (await browser("eval", `(() => { const box = document.querySelector('.rail-row[data-id="${id}"]').getBoundingClientRect(); return {x:box.x + box.width / 2,y:box.y + box.height / 2}; })()`)).result;
      await browser("mouse", "move", String(Math.round(point.x)), String(Math.round(point.y)));
      await browser("mouse", "down", "right");
      await browser("mouse", "up", "right");
    };

    const choose = async (id: string, action: string) => {
      await browser("eval", "window.__importMenu.shown = null");
      await rightClick(id);
      await wait(`window.__importMenu.shown?.some(item => item.id === '${action}' && item.enabled !== false)`);
      await browser("eval", `window.__importMenu.answer('${action}')`);
    };

    // Imported rows already report idle. Wait for the new Attempt and Terminal so
    // that status cannot acknowledge a resume/start which has not completed yet.
    const idle = async (id: string) => vi.waitFor(async () => {
      const node = (await app.rpc("rail.tree", null)).find((row) => row.id === id);

      expect(node?.attempt).toBe("1");
      expect(node?.terminal_id).toBeTruthy();
      expect(node?.status?.kind).toBe("idle");
    }, { timeout: 30_000 });

    await rightClick(parent.id);
    await wait("window.__importMenu.shown?.some(item => item.id === 'start' && item.enabled !== false)");
    await browser("eval", "window.__importMenu.answer(null)");

    const captures = captureDir("U3037d") ?? captureDir("U2875d");

    if (captures) {
      await mkdir(captures, { recursive: true });
      await browser("screenshot", join(captures, "imported-closed.png"));
    }

    // A fresh page cannot reuse the old connection after a Daemon restart.
    await browser("open", "about:blank");
    await real.restart();
    await browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1`);
    await wait(`!!document.querySelector('.rail-row[data-id="${child.id}"]')`);
    await activate(`.rail-row[data-id="${child.id}"] .name`);
    await browser("eval", "(async () => { window.__importMenu = (await import('/src/testing/menuProbe.ts')).menuProbe; })()");
    await choose(child.id, "resume");
    await idle(child.id);
    const resumed = (await app.rpc("rail.tree", null)).find((node) => node.id === child.id)!;

    expect(resumed.attempt).toBe("1");
    expect(resumed.terminal_id).not.toBeNull();
    expect((await app.rpc("terminal.list", null)).map((terminal) => terminal.id)).toContain(resumed.terminal_id);
    await choose(parent.id, "start");
    await idle(parent.id);
    expect((await app.rpc("rail.tree", null)).find((node) => node.id === parent.id)?.terminal_id).not.toBeNull();

    if (captures) {
      await browser("record", "start", join(captures, "recovery.webm"));
      await browser("set", "media", "dark");
      await browser("open", `${real.base}/harness.html?view=workstreams&items=1&tabs=1&seed=import-candidates`);
      await wait("!!window.__fake && !!document.querySelector('.todo-project-root')");
      await browser("eval", "window.dispatchEvent(new CustomEvent('open-project-page', { detail: { path: document.querySelector('.project-tab[data-selected=true]').dataset.path, command: 'import-work' } }))");
      await wait("document.querySelectorAll('.import-check').length === 10");

      const capture = async (step: string) => {
        await browser("screenshot", join(captures, `${step}.png`));
        await writeFile(join(captures, `${step}.checks.json`), JSON.stringify((await browser("eval", "window.__checks()")).result));
      };

      await capture("dense");
      await browser("eval", "document.querySelector('.import-list').scrollTop = 10000");
      await capture("unavailable");
      await browser("eval", "document.querySelector('.import-list').scrollTop = 0");
      await activate(".import-list li:nth-child(1) .import-check");
      await wait("document.querySelector('.import-confirm')?.textContent.includes('1')");
      await activate(".import-list li:nth-child(2) .import-check");
      await wait("document.querySelector('.import-confirm')?.textContent.includes('2')");
      await activate(".import-confirm");
      await wait("document.querySelector('.import-candidate [role=alert]')?.textContent.includes('The saved conversation changed')");
      expect((await browser("eval", "window.__fake.app.calls.filter(call => call.method === 'project.importCommit').at(-1).params.selections.length")).result).toBe(2);
      expect((await browser("eval", "document.querySelectorAll('.import-check[data-state=checked]').length")).result).toBe(1);
      await capture("partial-failure");
      await browser("eval", "document.querySelector('.import-list').scrollTop = document.querySelector('.import-list').scrollHeight");
      await wait("document.querySelector('.import-list').scrollTop > 0");
      await capture("unavailable");
      await activate(".import-confirm");
      await wait("!document.querySelector('.import-panel')");
      expect((await browser("eval", "window.__fake.app.calls.filter(call => call.method === 'project.importCommit').at(-1).params.selections.map(entry => entry.source)")).result).toEqual(["s0"]);
      await browser("eval", "window.dispatchEvent(new CustomEvent('open-project-page', { detail: { path: document.querySelector('.project-tab[data-selected=true]').dataset.path, command: 'import-work' } }))");
      await wait("document.querySelectorAll('.import-check').length > 0");

      for (const state of ["failure", "empty", "loading", ...(captureDir("U3037d") ? ["rpc-timeout", "deadline"] : [])]) {
        await browser("eval", `window.__fake.app.handlers['project.importDiscover'] = ${state === "failure" ? "() => { throw new Error('Discovery unavailable: permission denied. Retry with Refresh.'); }" : state === "rpc-timeout" ? "() => { throw new Error('no reply to project.importDiscover within 30s; whether the Daemon accepted the request is unknown. Refresh to try again.\\nSource: /a/very/long/path/without/spaces/that/must/wrap/and/remain/readable/while/the/recovery/actions/stay/available'); }" : state === "empty" ? "() => ({ candidates: [], excluded: [] })" : "() => new Promise(() => {})"}`);
        await browser("find", "role", "button", "click", "--name", "Refresh", "--exact");
        await wait(state === "rpc-timeout" ? "document.querySelector('.import-panel [role=alert]')?.textContent.includes('within 30s')" : state === "deadline" ? "document.querySelector('.import-panel [role=alert]')?.textContent.includes('too long')" : state === "failure" ? "document.querySelector('.import-panel [role=alert]')?.textContent.includes('Discovery unavailable')" : state === "empty" ? "document.querySelector('.import-panel [role=status]')?.textContent.includes('No conversations')" : "document.querySelector('.import-panel [role=status]')?.textContent.includes('Looking')");
        await capture(state);
      }

      await browser("record", "stop");
    }
  } finally { await fixture.close(); }
}, 240_000);

it("u4590_visible_launch_params_match_first_pty_grid", async () => {
  const { readFile, mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const scratch = await mkdtemp(join(tmpdir(), "u4590-"));
  // #4609's kernel-size program is the shared observer, rather than another vendor simulation.
  const source = await readFile(join(process.cwd(), "../../crates/agents/tests/scenarios/spawn.rs"), "utf8");
  const program = source.split('const SIZE_PROGRAM: &str = r#"exec python3 -c \'')[1]!.split("'\"#;")[0]!;
  const executable = join(scratch, "size-program");
  await writeFile(executable, "#!/usr/bin/env python3\n" + program, { mode: 0o755 });
  const command = JSON.stringify([executable]);
  const observed = await observer(1512, "pointer", "terminal-size", undefined, undefined, { SHELL: executable, FAKE_CLAUDE_CHILD_PROCESS: command, FAKE_CLAUDE_DOOR_PROCESS: command });
  const { real, browser, wait } = observed;
  const read = async <T,>(expression: string): Promise<T> => (await browser("eval", expression)).result;
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const app = createServedApp(real.base);
  const evidence = captureDir("U4590") ?? join(scratch, "evidence");
  mkdirSync(evidence, { recursive: true });

  try {
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("open", `${real.base}/harness.html?daemon=1&view=workstreams&items=1&tabs=1&renderer=dom`);
    await wait("!!document.querySelector('[aria-label=\"Create\"]')");
    await read(`(() => {
      window.__launches = [];
      window.__sizingWrites = [];
      const original = window.fetch.bind(window);
      window.fetch = async (url, options) => {
        const call = options?.body && JSON.parse(options.body);
        if (call?.method === 'terminal.write') window.__sizingWrites.push(call);
        const launch = call && ['rail.startDoor', 'agent.spawn', 'terminal.open'].includes(call.method);
        const fitted = launch ? [...window.__terminals.values()].at(-1).fit() : null;
        const response = await original(url, options);
        if (launch) window.__launches.push({ ...call, fitted, outcome: await response.clone().json() });
        return response;
      };
    })()`);

    for (const action of ["door", "agent", "prompt", "shell", "quick"]) {
      await read("window.__launches.length = 0");

      if (action === "door") { await browser("click", '[aria-label="Create"]'); await browser("click", '[role="menuitem"][data-value="workstream"]'); }
      else if (action === "agent") { await browser("click", '[aria-label="Create"]'); await browser("click", '[role="menuitem"][data-value="agent"]'); }
      else if (action === "prompt") {
        await browser("press", "Meta+Shift+n");
        await wait("document.activeElement?.matches('.spawn-prompt-field')");
        await browser("fill", ".spawn-prompt-field", "sizing-fixture");
        await browser("press", "Enter");
      }
      else if (action === "shell") await browser("click", ".terminal-new");
      else {
        await read("document.querySelector('.rail-row').click()");
        await wait("!document.querySelector('.bubble:not([hidden])')");
        await browser("press", "Meta+t");
      }

      await wait("window.__launches.length === 1");
      const trace = await read<{ method: string; params: { cols: number; rows: number }; fitted: { cols: number; rows: number }; outcome: { result: { terminal_id: string } } }>("window.__launches[0]");
      expect({ cols: trace.params.cols, rows: trace.params.rows }).toEqual(trace.fitted);
      expect(await read("window.__sizingWrites")).toEqual([]);
      const id = trace.outcome.result.terminal_id;
      const incarnation = (await app.rpc("terminal.list", null)).find(terminal => terminal.id === id)!.incarnation;
      let before = "";
      // A resize redraw clears the screen; the output log retains the program's first frame.
      await expect.poll(async () => {
        const output = await app.rpc("terminal.catchUp", { id, incarnation, after: 0 });
        expect(output.kind).toBe("contiguous");

        if (output.kind === "contiguous") before = Buffer.from(output.data, "base64").toString();

        return before;
      }).toContain("first ");
      expect(before).toContain(`first ${trace.fitted.cols} ${trace.fitted.rows}`);
      const pid = /pid=(\d+)/.exec(before)![1];
      await browser("set", "viewport", "1412", "850");

      if (action === "shell" || action === "quick") await browser("dblclick", ".bubble:not([hidden]) .bubble-header");
      let later = "";
      await expect.poll(async () => { const snapshot = await app.rpc("terminal.snapshot", { id }); later = Buffer.from(snapshot.data, "base64").toString();

 return later; }).toContain("later ");
      expect(later).toContain(`pid=${pid}`);
      expect((await app.rpc("terminal.list", null)).find(terminal => terminal.id === id)!.incarnation).toBe(incarnation);
      writeFileSync(join(evidence, `${action}-launch.json`), JSON.stringify({ trace, before, later, pid, incarnation }, null, 2));
      await browser("set", "viewport", "1512", "950");
      await wait("innerWidth === 1512 && innerHeight === 950 && document.fonts.status === 'loaded'");
      writeFileSync(join(evidence, `${action}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
      await browser("screenshot", join(evidence, `${action}.png`));
    }
  } finally { await observed.close(); await rm(scratch, { recursive: true, force: true }); }
}, 180_000);

it.skipIf(!captureDir("A4899a"))("a4899a_a_blocked_door_takes_the_named_ask_in_the_rendered_app", { retry: 0, timeout: 240_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "a4899a-observer-"));
  const log = join(dir, "prompts.jsonl");
  const real = await startRealDaemon({ FAKE_CLAUDE_PROMPT_LOG: log, FAKE_CLAUDE_EXACT_PROMPTS: "1" }, true);
  vi.stubEnv("AGENT_BROWSER_COLOR_SCHEME", "dark");
  const lane = await openLane(1512, "dark", "a4899a");
  const app = createServedApp(real.base);
  const events: { name: string; data?: unknown }[] = [];
  await app.subscribe(event => { events.push(event); });

  try {
    await lane.browser("set", "media", "dark");
    await lane.until("matchMedia('(prefers-color-scheme: dark)').matches");
    await mkdir(captureDir("A4899a")!, { recursive: true });
    await lane.browser("record", "start", join(captureDir("A4899a")!, "request-understand-intervene.webm"));
    await lane.until("typeof window.__checks === 'function' && !!document.querySelector('.ask-input')");
    await lane.browser("set", "media", "dark");
    await lane.until("matchMedia('(prefers-color-scheme: dark)').matches");
    // The densest existing seed remains the visual baseline for this delivery change.
    await lane.capture("A4899a", "tree-40");
    await lane.evaluate("window.__fake.failNext(-32003, 'Door unavailable. Start it and retry.')");
    await lane.browser("fill", ".ask-input", "@Feedback retain this failed draft");
    await lane.browser("press", "Enter");
    await lane.until("!!document.querySelector('.ask-send-status [role=alert]')");
    await lane.capture("A4899a", "tree-40-failure");
    const door = await app.rpc("rail.createWorkstream", { name: "Feedback", parent: null, order: { kind: "work", title: "Feedback", ask: "Review feedback", limits: [] } });
    await app.rpc("rail.startDoor", { id: door.id });
    await vi.waitFor(async () => { expect((await app.rpc("rail.tree", null)).find(node => node.id === door.id)?.status?.kind).toBe("idle"); });
    const ready = (await app.rpc("rail.tree", null)).find(node => node.id === door.id)!;
    const prompt = await app.rpc("terminal.read", { id: ready.terminal_id!, after: 0, reader: null, max: null });

    expect(prompt.text).toBe("");
    const blocker = await app.rpc("todo.create", { title: "Await review", body: null, blockers: null });

    // A33 follows the creator, so create through the Door's public CLI identity.
    const { stdout } = await promisify(execFile)(resolve(process.cwd(), "../../target/debug/rup"),
      ["todo", "create", "Apply feedback", "--blockers", String(blocker.id), "--agent", door.id, "--json"],
      { cwd: real.dir, env: { ...process.env, RUPD_SOCKET: join(real.dir, "rupd.sock") } });

    const todo: Todo = JSON.parse(stdout);
    await vi.waitFor(async () => { expect((await app.rpc("rail.tree", null)).find(node => node.id === door.id)?.status?.kind).toBe("blocked"); });
    await lane.browser("open", `${real.base}/harness.html?daemon=1&view=workstreams&items=1&tabs=1&seed=tree-40`);
    await lane.until("typeof window.__checks === 'function' && !!document.querySelector('.ask-input') && !!document.querySelector('[data-state=blocked]')");
    await lane.browser("set", "media", "dark");
    await lane.until("matchMedia('(prefers-color-scheme: dark)').matches");
    await lane.capture("A4899a", "blocked-before");
    const text = "@Feedback hello café\n  feedback 🚀";
    await lane.browser("fill", ".ask-input", text);
    await lane.browser("press", "Enter");
    await vi.waitFor(async () => {
      const asks = await app.rpc("ask.list", null);
      expect(asks[0]?.parts[0]).toMatchObject({ text, state: "typed" });
    });
    await lane.until("!document.querySelector('.ask-input').value");
    await lane.evaluate("window.dispatchEvent(new CustomEvent('open-project-page', { detail: { path: document.querySelector('.project-tab[data-selected=true]').dataset.path, command: 'view:ask-history' } }))");
    await lane.until("!!document.querySelector('.ask-row[data-state=typed]')");
    await lane.capture("A4899a", "sent-with-blocker");
    await vi.waitFor(async () => {
      const typed = (await readFile(log, "utf8")).trim().split("\n").map(line => JSON.parse(line)).filter(entry => !entry.inbox);
      expect(typed).toEqual([{ resume: false, prompt: text }]);
    });
    expect((await app.rpc("todo.list", null)).find(item => item.id === todo.id)?.blockers).toEqual([blocker.id]);
    expect(events.some(event => event.name === "agent.status" && JSON.stringify(event.data).includes('"working"'))).toBe(true);
  } finally {
    try { await lane.browser("record", "stop"); } finally {
      try { await lane.close(); } finally {
        await real.stop();
        await rm(dir, { recursive: true, force: true });
        vi.unstubAllEnvs();
      }
    }
  }
});

it("u5552a_restored_paste_reaches_only_the_focused_program", async () => {
  const profile = await mkdtemp(join(tmpdir(), "u5552-browser-"));
  const logs = await mkdtemp(join(tmpdir(), "u5552-input-"));
  const config = join(profile, "config.json");
  await writeFile(config, "{}");
  // The existing fake vendor starts a child with its settings environment. Each
  // raw PTY reader logs exact received bytes under its Agent identity.
  const program = `import os,tty,sys\ntty.setraw(0)\np=os.path.join(${JSON.stringify(logs)},os.environ['ROUNDUP_AGENT_ID'])\nopen(p,'wb').close()\nsys.stdout.write('\\x1b[?2004hREADY');sys.stdout.flush()\nwhile True:\n b=os.read(0,4096)\n if not b: break\n with open(p,'ab') as f: f.write(b);f.flush()\n`;
  const real = await startRealDaemon({ FAKE_CLAUDE_CHILD_PROCESS: JSON.stringify(["python3", "-u", "-c", program]) }, true);
  const app = createServedApp(real.base);
  const session = `u5552-${process.pid}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));

  const browser = async (...args: string[]) => {
    const { stdout } = await execute("agent-browser", ["--executable-path", chromePath()!, "--args", "--no-sandbox", "--config", config, "--profile", profile, "--session", session, "--json", ...args], { env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const reply = JSON.parse(stdout);

    if (!reply.success) throw new Error(reply.error);

    return reply.data;
  };

  const wait = (expression: string) => browser("wait", "--fn", expression);
  const read = async (expression: string) => (await browser("eval", expression)).result;
  const input = (id: string) => `document.activeElement?.closest('[data-terminal]')?.dataset.terminal === '${id}' && document.activeElement.matches('textarea')`;

  try {
    const agents: RailNode[] = [];

    for (const name of ["First", "Second"]) agents.push(await app.rpc("agent.spawn", { cwd: real.dir, parent: null, prompt: null, name, order: { kind: "work", ask: "inspect", limits: [] } }));

    for (const agent of agents) await vi.waitFor(async () => expect(await readFile(join(logs, agent.id))).toHaveLength(0), { timeout: 20_000 });
    await browser("open", `${real.base}/harness.html?daemon=1&view=workstreams&items=1&tabs=1`);
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");

    for (const agent of agents) {
      console.info("initial terminal", agent.id);
      await wait(`!!document.querySelector('.rail-row[data-id="${agent.id}"]')`);
      await browser("click", `.rail-row[data-id="${agent.id}"]`);
      await wait(`!!document.querySelector('[data-terminal="${agent.terminal_id}"] textarea')`);
      await browser("click", `[data-terminal="${agent.terminal_id}"] .xterm-screen`);
      await wait(input(agent.terminal_id!));
    }

    // Reload the webview only: both Daemon and fake-vendor PTYs stay alive.
    await browser("reload");
    await wait(`!!document.querySelector('.rail-row[data-id="${agents[0]!.id}"]')`);
    await read(`(() => { const fetch = window.fetch.bind(window); window.__writes = []; window.fetch = (url, options) => { if (String(url).endsWith('/__daemon/rpc')) { const call = JSON.parse(options.body); if (call.method === 'terminal.write') window.__writes.push(call.params); } return fetch(url, options); }; })()`);
    const received = ["", ""];

    for (const [step, index] of [0, 1, 0].entries()) {
      const agent = agents[index]!;
      console.info("restored paste", step, agent.id);

      if (step === 1) {
        // Existing Rail keyboard opening: focus the second row and Return.
        await browser("focus", `.rail-row[data-id="${agent.id}"]`);
        await browser("press", "Enter");
      } else {
        await browser("click", `.rail-row[data-id="${agent.id}"]`);
        await wait(`!!document.querySelector('[data-terminal="${agent.terminal_id}"] textarea')`);
        await browser("click", `[data-terminal="${agent.terminal_id}"] .xterm-screen`);
      }

      await wait(input(agent.terminal_id!));
      const payload = [`first 界\nline α`, `second λ\nline 二`, `third 雨\nline β`][step]!;
      await read(`(() => { const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify(payload)}); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); })()`);
      const framed = `\x1b[200~${payload.replaceAll("\n", "\r")}\x1b[201~`;
      received[index] += framed;
      await vi.waitFor(async () => expect(await readFile(join(logs, agent.id), "utf8")).toBe(received[index]), { timeout: 20_000 });
      expect(await readFile(join(logs, agents[1 - index]!.id), "utf8")).toBe(received[1 - index]);
      expect(await read("window.__writes.map(call => ({id:call.id, data:call.data}))")).toEqual([...Array(step + 1)].map((_, n) => ({ id: agents[[0, 1, 0][n]!]!.terminal_id, data: Buffer.from(`\x1b[200~${[`first 界\nline α`, `second λ\nline 二`, `third 雨\nline β`][n]!.replaceAll("\n", "\r")}\x1b[201~`).toString("base64") })));
      const out = captureDir("U5552a");

      if (out) {
        await mkdir(out, { recursive: true });
        await browser("screenshot", join(out, `restored-paste-${step}.png`));
        await writeFile(join(out, `restored-paste-${step}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
      }
    }
  } catch (error) {
    console.error(await read("({active:document.activeElement.tagName+':'+document.activeElement.className,terminals:[...document.querySelectorAll('[data-terminal]')].map(el=>({id:el.dataset.terminal,hidden:el.closest('[hidden]')?.outerHTML.slice(0,200)})),body:document.body.innerText.slice(0,1500)})"));
    throw error;
  } finally {
    await browser("close");
    await real.stop();
    await rm(logs, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 180_000);
