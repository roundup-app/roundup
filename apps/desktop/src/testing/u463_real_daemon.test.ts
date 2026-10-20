import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { captureDir } from "./captures";
import { chromePath } from "./chromePage";
import { startRealDaemon, startWorktreeProject } from "./realDaemonFixture";
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
      await rm(profile, { recursive: true, force: true });
    }
  } };
};

// One window, 1280 by 800, the narrowest supported; both input paths stay.
const width = 1280;

for (const input of ["keyboard", "pointer"] as const) {
  it(`u463_first_run_chooses_the_configured_project_and_reaches_its_real_door_terminal ${width} ${input}`, async () => {
    const fixture = await observer(width, input, "choose", DOOR_REQUEST);
    const { real, browser, wait, activate, app } = fixture;

    try {
      await browser("open", `${real.base}/harness.html?daemon=1&seed=first-run`);
      await browser("set", "viewport", String(width), "800");
      await wait(`document.body.textContent.includes('Open a folder to start')`);
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
      await wait(`document.body.textContent.includes('New Workstream')`);

      expect((await browser("eval", "document.querySelector('.project-tab[data-path]').dataset.path")).result).toBe(real.dir);
      await activate(".pane-action");
      // U191: creating the Workstream starts its Door once rail.tree acknowledges the row.
      await wait(`window.__u463Calls.some(call => call.method === 'rail.startDoor')`);
      await wait(`!!document.querySelector('.pane-screen textarea') && !!document.querySelector('.rail-row[data-kind="idle"]')`);
      const tree = await app.rpc("rail.tree", null);
      const workstream = tree.find((node) => node.kind === "workstream")!;
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
    await browser("open", `${real.base}/harness.html?daemon=1&seed=first-run`);
    await browser("set", "viewport", String(width), "800");
    await wait(`document.body.textContent.includes('Open a folder to start')`);
    expect((await browser("eval", "document.querySelectorAll('[role=tablist][aria-label=Projects] [role=tab]').length")).result).toBe(0);

    await browser("eval", "window.__firstRun.cancelNextChoice()");
    await activate('[aria-label="Centre"] button');
    // The chooser's null result creates no asynchronous RPC work (state/projects.ts choose).
    expect((await browser("eval", "document.querySelectorAll('.project-tab [role=tab]').length")).result).toBe(0);
    expect(await app.rpc("rail.tree", null)).toEqual([]);
    expect(await app.rpc("terminal.list", null)).toEqual([]);
    await wait(`document.body.textContent.includes('Open a folder to start')`);
    await activate('[aria-label="Centre"] button');
    await wait(`!!document.querySelector('.pane-action')`);
    expect((await browser("eval", "document.querySelector('.project-tab[data-path]').dataset.path")).result).toBe(real.dir);
    expect(await app.rpc("rail.tree", null)).toEqual([]);
  } finally { await fixture.close(); }
}, 180_000);

it(`u463_the_first_run_observer_is_opt_in_and_confined_to_its_project ${width} keyboard`, async () => {
  const fixture = await observer(width, "keyboard", "boundary");
  const { real, browser, wait, activate, app } = fixture;

  try {
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await browser("set", "viewport", String(width), "800");
    await wait(`!!document.querySelector('.pane-action')`);
    expect((await browser("eval", "typeof window.__firstRun")).result).toBe("undefined");
    expect(await app.chooseProjectPath()).toBeNull();
    expect(await app.chooseSavePath("test.md")).toBeNull();
    await activate('[aria-label="Open a folder"]');
    expect((await browser("eval", "[...document.querySelectorAll('[role=tablist][aria-label=Projects] .project-tab[data-path]')].map(tab => tab.dataset.path)")).result).toEqual([real.dir]);

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

// U2773g composes the category proofs on one real Project; it adds no editor or storage seam.
it("u2773g_journey_retains_unfinished_work", async () => {
  const real = await startWorktreeProject({ "result.txt": "original result\n" }, {
    FAKE_CLAUDE_DOOR_PROCESS: JSON.stringify(["python3", "-c", "import subprocess,sys\nsubprocess.run(sys.argv[1:],check=True)\nsubprocess.run([sys.argv[1], '--json', 'todo', 'create', 'Reviewed result'],check=True)", resolve("../../target/debug/rup"), "--json", "agent", "ask", "Review this result?", "--answers", JSON.stringify({ label: "Keep", description: "retain the result" }), "--answers", JSON.stringify({ label: "Revise", description: "change the result" })]),
  }, true);

  const fixture = await observer(1512, "keyboard", "unfinished", undefined, real);
  const { browser, wait, activate, app } = fixture;
  const evaluate = async (source: string) => (await browser("eval", source)).result;

  const ask = "@workstream  exact e\u0301 🧭\nlast line  ";
  const answer = "  review e\u0301\nkeep 🧭  ";
  const note = "  diff e\u0301\ninspect 🧭  ";

  const capture = async (step: string) => {
    const dir = captureDir("U2773g");

    if (!dir) return;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${step}.checks.json`), JSON.stringify(await evaluate("window.__checks()")));
    await browser("screenshot", join(dir, `${step}.png`));
  };

  const press = async (name: string) => {
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(name)}).focus()`);
    await browser("press", "Enter");
  };

  const openAsk = async () => {
    await browser("press", "Meta+/");
    await wait("document.activeElement === document.querySelector('.ask-input')");
  };

  // The served transport is the failure boundary: each selected call is refused before
  // execution or loses its acknowledgement after real execution. All other RPCs stay real.
  const failNext = (method: string, unknown: boolean) => evaluate(`(() => {
    const transport = window.fetch;
    window.fetch = async (url, options) => {
      if (String(url).endsWith('/__daemon/rpc') && JSON.parse(options.body).method === ${JSON.stringify(method)}) {
        window.fetch = transport;
        if (${unknown}) { await transport(url, options); throw new TypeError('acknowledgement lost'); }
        return new Response(JSON.stringify({error:{code:-32003,message:'journey refused'}}), {headers:{'Content-Type':'application/json'}});
      }
      return transport(url, options);
    };
  })()`);

  try {
    await browser("open", `${real.base}/harness.html?daemon=1&seed=first-run`);
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await wait("document.body.textContent.includes('Open a folder to start')");
    await activate('[aria-label="Centre"] button');
    await wait("!!document.querySelector('.pane-action')");
    await activate(".pane-action");
    await wait("!!document.querySelector('.ask-note textarea')");
    const door = (await app.rpc("rail.tree", null)).find(node => node.kind === "workstream")!;
    const decision = (await app.rpc("decision.list", null))[0]!;
    const identity = await app.rpc("decision.capture", { id: decision.id });
    expect(await evaluate("document.querySelector('.project-tab').dataset.path")).toBe(real.dir);
    await capture("entered");

    await openAsk();
    await browser("fill", ".ask-input", ask);
    await failNext("ask.send", false);
    await browser("press", "Enter");
    await wait("document.querySelector('.ask-send-status [role=alert]')?.textContent.includes('journey refused')");
    expect(await evaluate("document.querySelector('.ask-input').value")).toBe(ask);
    expect(await app.rpc("ask.list", null)).toEqual([]);
    await capture("request-refused");
    await browser("press", "Escape");
    await wait("!document.querySelector('.ask-input')");

    await browser("fill", ".ask-note textarea", answer);
    await evaluate("(() => { const field = document.querySelector('.ask-note textarea'); field.setSelectionRange(2, 8, 'backward'); field.dispatchEvent(new Event('select', {bubbles:true})); })()");
    // Incoming authoritative events must preserve work and the focused editor.
    await app.rpc("rail.rename", { id: door.id, name: "renamed original" });
    await wait("document.querySelector('.rail-row .name')?.textContent === 'renamed original'");
    expect(await evaluate("[document.querySelector('.ask-note textarea').value, document.activeElement === document.querySelector('.ask-note textarea')]")).toEqual([answer, true]);
    // The opt-in first-run chooser is intentionally empty on every load; reopen the selected Project through its normal harness route.
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await wait("!!document.querySelector('.ask-note textarea')");
    expect(await evaluate("(() => { const field = document.querySelector('.ask-note textarea'); return [field.value, field.selectionStart, field.selectionEnd, field.selectionDirection]; })()")).toEqual([answer, 2, 8, "backward"]);
    expect(await app.rpc("decision.answers", { agent: door.id })).toEqual([]);
    await openAsk();
    expect(await evaluate("document.querySelector('.ask-input').value")).toBe(ask);
    expect(await app.rpc("ask.list", null)).toEqual([]);
    // Retry is a user action, with the captured original Workstream despite its rename.
    await failNext("ask.send", true);
    await browser("press", "Enter");
    await wait("!!document.querySelector('.ask-unknown-state')");
    const accepted = await app.rpc("ask.list", null);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ text: ask, parts: [{ placement: { kind: "routed", workstream: door.id } }] });
    await browser("reload");
    await wait("!!document.querySelector('.rail-row')");
    await openAsk();
    await wait("!!document.querySelector('.ask-unknown-state')");
    expect(await app.rpc("ask.list", null)).toHaveLength(1);
    await browser("click", ".ask-send-status button");
    await wait("!document.querySelector('.ask-unknown-state')");
    expect(await app.rpc("ask.list", null)).toHaveLength(1);
    await browser("press", "Escape");
    await wait("!!document.querySelector('.ask-note textarea') && !document.querySelector('.ask-input')");
    expect(await evaluate("document.querySelector('.ask-note textarea').value")).toBe(answer);
    await failNext("decision.answer", false);
    await browser("click", ".ask-note button");
    await wait("!!document.querySelector('.decision-card [role=alert]')");
    expect(await evaluate("document.querySelector('.ask-note textarea').value")).toBe(answer);
    expect(await app.rpc("decision.answers", { agent: door.id })).toEqual([]);
    await browser("click", ".ask-note button");
    await wait("!document.querySelector('.ask-note textarea')");
    expect(await app.rpc("decision.answers", { agent: door.id })).toMatchObject([{ answer: "Keep", note: answer, attempt: identity.attempt, answered_by: { kind: "user", id: "you" } }]);
    await wait("[...document.querySelectorAll('[data-todo]')].some(row => row.textContent.includes('Reviewed result'))");
    const todos = await app.rpc("todo.list", null);

    expect(todos).toMatchObject([{ title: "Reviewed result", home: door.id }]);
    await capture("intervened");

    const current = (await app.rpc("rail.tree", null)).find(node => node.id === door.id)!;
    await writeFile(join(current.worktree!.path, "result.txt"), "changed result\n");
    expect(await app.rpc("agent.changedFiles", { id: door.id })).toEqual({ files: [{ path: "result.txt", status: "modified", line: 1 }] });
    await wait("!!document.querySelector('.worktree-control')");
    await press(current.worktree!.branch);
    await wait(`!!document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-path="result.txt"]')`);
    await evaluate(`document.querySelector('file-tree-container').shadowRoot.querySelector('[data-item-path="result.txt"]').click()`);
    await wait("[...document.querySelectorAll('button')].some(button => button.textContent === 'View diff' && !button.disabled)");
    await press("View diff");
    await wait("!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-column-number]')");
    await press("Add note");
    await browser("fill", ".note-form textarea", note);
    await capture("review-before-failure");
    await evaluate("(() => { window.__retentionWrite = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith('roundup:drafts:')) throw new Error('journey storage refused'); return window.__retentionWrite.call(this, key, value); }; })()");
    await browser("fill", ".note-form textarea", note + "newer");
    await wait("!!document.querySelector('.note-batch [role=alert]')");
    expect(await evaluate("document.querySelector('.note-form textarea').value")).toBe(note + "newer");
    await capture("review-retention-failed");
    const before = await app.rpc("message.list", { to: door.id, status: null });
    await evaluate("Storage.prototype.setItem = window.__retentionWrite");
    await press("Review recovery options");
    await wait("!!document.querySelector('.note-recovery')");
    await press("Retry");
    await wait("!document.querySelector('.note-recovery [role=alert]')");
    await press("Close");
    await wait("!document.querySelector('.note-batch [role=alert]')");
    await browser("open", "about:blank");
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await wait("!!document.querySelector('.worktree-control')");
    await press(current.worktree!.branch);
    await wait(`!!document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-path="result.txt"]')`);
    await evaluate(`document.querySelector('file-tree-container').shadowRoot.querySelector('[data-item-path="result.txt"]').click()`);
    await wait("[...document.querySelectorAll('button')].some(button => button.textContent === 'View diff' && !button.disabled)");
    await press("View diff");
    await wait("!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-column-number]')");
    await press("Add note");
    expect(await evaluate("document.querySelector('.note-form textarea').value")).toBe(note + "newer");
    expect(await app.rpc("message.list", { to: door.id, status: null })).toEqual(before);
    expect(await app.rpc("ask.list", null)).toHaveLength(1);
    expect(await app.rpc("decision.answers", { agent: door.id })).toHaveLength(1);
    expect(await evaluate("typeof window.__fake")).toBe("undefined");
    expect(await app.rpc("todo.list", null)).toEqual(todos);
    await capture("review-reopened");

    if (captureDir("U2773g")) {
      // Reuse the densest established diff seed solely for the critic observer.

      for (const state of ["dense", "dense&retention"]) {
        await browser("open", `${real.base}/src/changes/u2540.html?${state}`);
        await wait("!!document.querySelector('.worktree-control')");
        await press("roundup/agent-1");
        await wait("!!document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-type=file]')");
        await evaluate("document.querySelector('file-tree-container').shadowRoot.querySelector('[data-item-type=file]').click()");
        await wait("[...document.querySelectorAll('button')].some(button => button.textContent === 'View diff' && !button.disabled)");
        await press("View diff");
        await wait("document.querySelectorAll('[aria-label=Notes] > li').length === 100");

        if (state.includes("retention")) await wait("!!document.querySelector('.note-batch [role=alert]')");
        await capture(state.includes("retention") ? "dense-retention-failed" : "dense-before-failure");
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ body: await evaluate("document.body.innerText"), panel: await evaluate("document.querySelector('.worktree-panel')?.outerHTML"), tree: await app.rpc("rail.tree", null), decisions: await app.rpc("decision.list", null) }));
    throw error;
  } finally { await fixture.close(); }
}, 240_000);

it("u2773a_changes_real_project_reopen_and_reload_restore_exact_form", async () => {
  const real = await startWorktreeProject({ "result.txt": "original result\n" }, {}, true);
  const fixture = await observer(1512, "keyboard", "changes-reopen", undefined, real);
  const { browser, wait, app } = fixture;
  const evaluate = async (source: string) => (await browser("eval", source)).result;
  const text = "  unfinished e\u0301\n🧭 exact  ";
  const node = await app.rpc("agent.spawn", { cwd: real.dir, parent: null, prompt: null, name: "Original", order: { kind: "work", ask: "inspect", limits: [] } });

  const press = async (name: string) => {
    await evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(name)}).click()`);
  };

  const form = async () => {
    await wait(`!!document.querySelector('.rail-row[data-id="${node.id}"] .name')`);
    await evaluate(`document.querySelector('.rail-row[data-id="${node.id}"] .name').click()`);
    await wait("!!document.querySelector('.worktree-control')");
    await press(node.worktree!.branch);
    await wait(`!!document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-path="result.txt"]')`);
    await evaluate(`document.querySelector('file-tree-container').shadowRoot.querySelector('[data-item-path="result.txt"]').click()`);
    await wait("[...document.querySelectorAll('button')].some(button => button.textContent === 'View diff' && !button.disabled)");
    await press("View diff");
    await wait("!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-column-number]')");
    await press("Add note");
    await wait("!!document.querySelector('.note-form textarea')");
  };

  try {
    await writeFile(join(node.worktree!.path, "result.txt"), "changed result\nsecond line\n");
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await form();
    await browser("fill", ".note-form textarea", text);
    await browser("find", "label", "End line", "fill", "2");
    await evaluate("(() => { const field = document.querySelector('.note-form textarea'); field.setSelectionRange(2, 9, 'backward'); field.dispatchEvent(new Event('select', { bubbles: true })); })()");

    for (const navigation of ["reload", "reopen"]) {
      if (navigation === "reload") await browser("reload");
      else {
        await browser("open", "about:blank");
        await browser("open", `${real.base}/harness.html?daemon=1`);
      }

      await form();
      expect(await evaluate("(() => { const field = document.querySelector('.note-form textarea'); return [field.value, field.selectionStart, field.selectionEnd, field.selectionDirection]; })()")).toEqual([text, 2, 9, "backward"]);
      expect(await evaluate("[...document.querySelectorAll('.note-form input')].map(field => field.value)")).toEqual(["1", "2"]);
      expect(await app.rpc("message.list", { to: node.id, status: null })).toEqual([]);
      expect(await app.rpc("agent.changedFiles", { id: node.id })).toEqual({ files: [{ path: "result.txt", status: "modified", line: 1 }] });
    }
  } finally { await fixture.close(); }
}, 180_000);

it("u2875d_real_import_reopen_and_resume", async () => {
  const fixture = await observer(1512, "pointer", "import", undefined, undefined, { FAKE_CLAUDE_LAUNCH_LOG: "/dev/null" });
  const { real, browser, wait, activate, app } = fixture;

  try {
    const recorded = await readFile(resolve(process.cwd(), "../../crates/agents/tests/fixtures/import-2.1.300/top-level.jsonl"), "utf8");
    const stamped = recorded.replaceAll("/fixture/project", real.dir).replace(/"timestamp":"[^"]+"/g, () => `"timestamp":"${new Date().toISOString()}"`);
    const bucket = join(real.dir, "claude-config", "projects", "bucket");

    await mkdir(bucket, { recursive: true });
    await writeFile(join(bucket, "00000001-1111-4111-8111-111111111111.jsonl"), stamped);
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await wait("!!document.querySelector('.rail-import')");
    await activate(".rail-import");
    await wait("!!document.querySelector('.import-check')");
    await activate(".import-check");
    await wait("!document.querySelector('.import-confirm').disabled");
    await activate(".import-confirm");
    await wait("!document.querySelector('.import-panel') && !!document.querySelector('.rail-row[data-id]')");
    const child = (await app.rpc("rail.tree", null)).find((node) => node.kind === "agent")!;
    const parent = (await app.rpc("rail.tree", null)).find((node) => node.id === child.parent)!;

    expect([child.terminal_id, child.attempt, child.status_revision, child.can_resume]).toEqual([null, null, null, true]);
    expect(await app.rpc("terminal.list", null)).toEqual([]);
    await wait(`[...document.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === 'Start supervisor')`);

    const captures = captureDir("U2875d");

    if (captures) {
      await mkdir(captures, { recursive: true });
      await browser("screenshot", join(captures, "imported-closed.png"));
    }

    // A fresh page cannot reuse the old connection after a Daemon restart.
    await browser("open", "about:blank");
    await real.restart();
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await wait(`!!document.querySelector('.rail-row[data-id="${child.id}"]')`);
    await activate(`.rail-row[data-id="${child.id}"] .name`);
    await wait(`[...document.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === 'Resume')`);
    await browser("find", "role", "button", "click", "--name", "Resume", "--exact");
    await wait(`!!document.querySelector('.rail-row[data-id="${child.id}"][data-kind="idle"]')`);
    const resumed = (await app.rpc("rail.tree", null)).find((node) => node.id === child.id)!;

    expect(resumed.attempt).toBe("1");
    expect(resumed.terminal_id).not.toBeNull();
    expect((await app.rpc("terminal.list", null)).map((terminal) => terminal.id)).toContain(resumed.terminal_id);
    await browser("find", "role", "button", "click", "--name", "Start supervisor", "--exact");
    await wait(`!!document.querySelector('.rail-row[data-id="${parent.id}"][data-kind="idle"]')`);
    expect((await app.rpc("rail.tree", null)).find((node) => node.id === parent.id)?.terminal_id).not.toBeNull();

    if (captures) {
      await browser("set", "media", "dark");
      await browser("open", `${real.base}/harness.html?seed=tree-40`);
      await wait("!!window.__fake && !!document.querySelector('.rail-import')");
      await browser("eval", `(() => {
        const app = window.__fake.app;
        window.__importCandidates = Array.from({ length: 10 }, (_, i) => ({ source: 's' + i, title: '調査と実装 — résumé — ' + 'Long conversation title '.repeat(8) + i, cwd: 'packages/deep/' + 'folder/'.repeat(10) + 'destination-' + i, last_activity_ms: BigInt(Date.now() - i * 1000), revision: 'r' + i }));
        app.handlers['project.importDiscover'] = () => ({ candidates: window.__importCandidates, excluded: [{ source: 'missing', reason: 'Source unavailable: recorded folder no longer exists.' }] });
        app.handlers['project.importCommit'] = ({ selections }) => ({ outcomes: selections.map(entry => ({ source: entry.source, workstream: null, agent: null, error: 'Copy refused: source changed. Refresh and choose again.' })) });
      })()`);
      await activate(".rail-import");
      await wait("document.querySelectorAll('.import-check').length === 10");

      const capture = async (step: string) => {
        await browser("screenshot", join(captures, `${step}.png`));
        await writeFile(join(captures, `${step}.checks.json`), JSON.stringify((await browser("eval", "window.__checks()")).result));
      };

      await capture("dense");
      await activate(".import-check");
      await wait("!document.querySelector('.import-confirm').disabled");
      await activate(".import-confirm");
      await wait("document.querySelector('.import-error')?.textContent.includes('Copy refused')");
      await capture("partial-failure");

      for (const state of ["failure", "empty", "loading"]) {
        await browser("eval", `window.__fake.app.handlers['project.importDiscover'] = ${state === "failure" ? "() => { throw new Error('Discovery unavailable: permission denied. Retry with Refresh.'); }" : state === "empty" ? "() => ({ candidates: [], excluded: [] })" : "() => new Promise(() => {})"}`);
        await browser("find", "role", "button", "click", "--name", "Refresh", "--exact");
        await wait(state === "failure" ? "document.querySelector('.import-panel [role=alert]')?.textContent.includes('Discovery unavailable')" : state === "empty" ? "document.querySelector('.import-panel [role=status]')?.textContent.includes('No conversations')" : "document.querySelector('.import-panel [role=status]')?.textContent.includes('Looking')");
        await capture(state);
      }
    }
  } finally { await fixture.close(); }
}, 240_000);
