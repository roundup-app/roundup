import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";
import { CHECK_IDS, type Checks } from "../testing/checks";
import { appServer } from "../testing/appServer";
import { chromePath } from "../testing/chromePage";
import { captureDir } from "../testing/captures";

const execute = promisify(execFile);

// The bundled CLI avoids the npm wrapper's per-input startup (todos/laneBrowser.ts).
const native = join(createRequire(import.meta.url).resolve("agent-browser/package.json"), "..", "bin", `agent-browser-${process.platform}-${process.arch}`);

const command = existsSync(native) ? native : "agent-browser";

const reactionBrowser = async () => {
  const profile = await mkdtemp(join(tmpdir(), "nr9-browser-"));
  const config = join(profile, "config.json");
  await writeFile(config, "{}");
  const executable = chromePath();

  if (!executable) throw new Error("NR9 needs headless Chromium");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));
  const session = `nr9-${process.pid}-${profile.split("-").at(-1)}`;

  const browser = async (...args: string[]) => {
    const { stdout } = await execute(command, ["--executable-path", executable, "--args", "--no-sandbox", "--config", config, "--session", session, "--profile", profile, "--json", ...args], { env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const answer = JSON.parse(stdout);

    if (!answer.success) throw new Error(stdout);

    return answer.data;
  };

  const evaluate = async (source: string) => (await browser("eval", source)).result;
  const wait = (source: string) => browser("wait", "--fn", source);

  return { browser, evaluate, wait, close: async () => {
    await browser("close").catch(() => {});
    await rm(profile, { recursive: true, force: true });
  } };
};

it.skipIf(!captureDir("P3557c") && !captureDir("U3791b"))("u3791b_p3557c_failure_lifetime_reactions_rendered", async () => {
  const server = await appServer();
  const profile = await mkdtemp(join(tmpdir(), "p3557c-browser-"));
  const config = join(profile, "config.json");
  await writeFile(config, "{}");
  const executable = chromePath();

  if (!executable) throw new Error("P3557c needs headless Chromium");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_")));
  const session = `p3557c-${process.pid}`;

  const browser = async (...args: string[]) => {
    const { stdout } = await execute("agent-browser", ["--executable-path", executable, "--args", "--no-sandbox", "--config", config, "--session", session, "--profile", profile, "--json", ...args], { env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const answer = JSON.parse(stdout);

    if (!answer.success) throw new Error(stdout);

    return answer.data;
  };

  const evaluate = async (source: string) => (await browser("eval", source)).result;
  const dir = (captureDir("U3791b") ?? captureDir("P3557c"))!;
  await mkdir(dir, { recursive: true });

  const capture = async (step: string) => {
    const checks = await evaluate("window.__checks()");
    await writeFile(join(dir, `reactions-${step}.checks.json`), JSON.stringify(checks));
    await browser("screenshot", join(dir, `reactions-${step}.png`));

    return checks;
  };

  try {
    await browser("set", "media", "dark");
    await browser("set", "viewport", "1512", "950");
    await browser("open", `${server.resolvedUrls.local[0]}harness.html?view=workstreams&items=1&tabs=1&view=reactions&seed=tree-40`);
    await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.reaction-head')");
    await evaluate(`(() => {
      const record = {
        project: 'p', id: 'reaction-lifetime', name: 'Review changes', actor: { kind: 'user', id: 'you', parent: null }, home: null, target: 'agent-1',
        instruction: 'Review the saved changes', condition: { kind: 'agents', ids: ['agent-1'], any: false }, max_firings: 1, remaining: 1, rearm: false,
        expires_at: '2026-10-24T09:00:00Z', created_at: '2026-10-23T09:00:00Z', state: 'active',
        observation: { health: 'observing', health_code: 'observing', cause_code: "unknown", gap_code: "unknown", recovery_code: "unknown", cursor: null, gap: null, recovery: null, evidence: null }, firings: [],
      };
      window.__fake.app.handlers['reaction.list'] = () => [record];
      window.__fake.app.handlers['reaction.get'] = () => record;
      window.__fake.app.handlers['reaction.run'] = () => { throw new Error('Could not run the reaction. Try Run now again.'); };
      window.dispatchEvent(new Event('focus'));
    })()`);
    await browser("wait", "--fn", "!!document.querySelector('[data-reaction-opener=reaction-lifetime]')");
    await evaluate("document.querySelector('[data-reaction-opener=reaction-lifetime]').click()");
    await browser("wait", "--fn", "!!document.querySelector('.reaction-detail')");
    const baseline = await capture("before");
    let observationChecks = baseline;

    if (captureDir("U3791b")) {
      await evaluate(`(() => {
        const app = window.__fake.app;
        const original = app.handlers['reaction.get']({ id: 'reaction-lifetime' });
        const record = { ...original, observation: { ...original.observation, health: 'unavailable', health_code: 'unavailable', cause_code: 'worktree-read-failed', recovery_code: 'check', cause: 'unsupported /private/diagnostic', recovery: 'diagnostic only' } };
        app.handlers['reaction.get'] = () => record;
        app.handlers['reaction.list'] = () => [record];
        [...document.querySelectorAll('.reaction-actions button')].find(button => button.textContent === 'Refresh').click();
      })()`);
      await browser("wait", "--fn", "!!document.querySelector('.reaction-detail .reaction-facts [role=alert]')");
      await evaluate("document.querySelector('.reaction-detail [role=alert]').scrollIntoView({ block: 'center' })");
      observationChecks = await capture("typed-observation-failure");
    }

    if (captureDir("U3791b")) {
      await evaluate(`(() => {
        const app = window.__fake.app;
        const previous = app.handlers['reaction.get']({ id: 'reaction-lifetime' });
        const record = { ...previous, observation: { ...previous.observation, health: 'observing', health_code: 'observing', cause_code: 'unknown', recovery_code: 'unknown', cause: null, recovery: null } };
        app.handlers['reaction.get'] = () => record;
        app.handlers['reaction.list'] = () => [record];
        [...document.querySelectorAll('.reaction-actions button')].find(button => button.textContent === 'Refresh').click();
      })()`);
      await browser("wait", "--fn", "!document.querySelector('.reaction-detail [role=alert]')");
    }

    await evaluate("[...document.querySelectorAll('.reaction-actions button')].find(button => button.textContent === 'Run now').click()");
    await browser("wait", "--fn", "!!document.querySelector('.reaction-detail [role=alert]')");
    const failed = await capture("failure");
    await evaluate("[...document.querySelectorAll('.reaction-detail button')].find(button => button.textContent === 'Clear').click()");
    await browser("wait", "--fn", "!document.querySelector('.reaction-detail [role=alert]')");
    const cleared = await capture("cleared");

    for (const checks of [baseline, observationChecks, failed, cleared]) {
      for (const id of ["D2", "D5", "D6"]) expect(checks[id]).toMatchObject({ status: "pass" });

      for (const id of CHECK_IDS) {
        if (baseline[id].status === "pass") expect(checks[id], id).toMatchObject({ status: "pass" });
      }
    }
  } finally {
    await browser("close").catch(() => {});
    await server.close();
    await rm(profile, { recursive: true, force: true });
  }
}, 60_000);

it.each(["all", "any", "pr-checks", "instant"])("u4276b_keyboard_creates_each_condition: %s", async kind => {
  const forge = await mkdtemp(join(tmpdir(), "u4276b-forge-"));
  // Exercise the production collector and NR7 pinning with deterministic external CLI replies.
  await writeFile(join(forge, "wt"), `#!/usr/bin/env python3
import json, subprocess, sys
rows = []
for entry in subprocess.check_output(['git', 'worktree', 'list', '--porcelain'], text=True).strip().split('\\n\\n'):
    fields = dict(line.split(' ', 1) for line in entry.splitlines() if ' ' in line)
    rows.append({'branch': fields.get('branch', '').removeprefix('refs/heads/'), 'worktree': {'path': fields['worktree']}, 'pr': {'number': 23}, 'checks': {'status': 'running', 'source': 'pr', 'stale': False}})
print(json.dumps({'schema': 2, 'repo': {}, 'collected': {'ci': '--full' in sys.argv, 'summary': False}, 'items': rows}))
`, { mode: 0o755 });
  await writeFile(join(forge, "gh"), `#!/bin/sh
case "$1 $2" in
"pr view") echo '{"number":23,"headRefOid":"1111111111111111111111111111111111111111","url":"https://github.com/acme/keyboard/pull/23"}';;
"pr checks") echo '[{"name":"check","bucket":"pending"}]'; exit 8;;
*) exit 1;;
esac
`, { mode: 0o755 });
  const real = await startRealDaemon(kind === "pr-checks" ? { PATH: `${forge}:${process.env.PATH}` } : {}, true);
  const { browser, evaluate, wait, close } = await reactionBrowser();
  const app = createServedApp(real.base);
  const dir = captureDir("U4276b");

  const tabTo = async (selector: string, reverse = false) => {
    for (let step = 0; step < 40; step++) {
      if (await evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})`)) return;
      await browser("press", reverse ? "Shift+Tab" : "Tab");
    }

    throw new Error(`Keyboard could not reach ${selector}: ${await evaluate("document.activeElement?.outerHTML")}`);
  };

  const type = (text: string) => browser("keyboard", "type", text);
  const field = async (selector: string, text: string) => { await tabTo(selector); await type(text); };

  try {
    const agents: RailNode[] = [];

    if (kind === "pr-checks") {
      for (const args of [["init", "-b", "main"], ["-c", "user.name=Observer", "-c", "user.email=observer@example.invalid", "commit", "--allow-empty", "-m", "base"]]) await execute("git", ["-C", real.dir, ...args]);
      await app.rpc("project.setWorktrees", { on: true, check: "true" });
    }

    for (let n = 0; n < 10; n++) agents.push(await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: null, name: n === 0 ? "Exact recipient" : `Same long watched Agent name ${n}` }));

    if (kind === "pr-checks") await vi.waitUntil(async () => (await app.rpc("agent.worktreeState", { id: agents[0]!.id })).evidence?.head === "1111111111111111111111111111111111111111", { timeout: 20_000 });
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("open", `${real.base}/harness.html?view=reactions&daemon=1`);
    await evaluate(`(() => {
      window.__reactionCalls = [];
      const send = window.fetch;
      window.fetch = async (url, options) => {
        const call = options?.body ? JSON.parse(options.body) : null;
        if (call?.method?.startsWith('reaction.')) window.__reactionCalls.push(call);
        return send(url, options);
      };
    })()`);
    await wait("!!document.querySelector('[data-reaction-opener=create]')");
    // The requested screen follows the dense Rail in document order. Reach its
    // last action backwards without opening the separate Ask overlay.
    await tabTo('[data-reaction-opener="create"]', true);
    await browser("press", "Enter");
    await wait("document.activeElement?.matches('.reaction-back')");
    await field('.reaction-form [data-scope="field"][data-part="input"]', `Keyboard ${kind}`);
    await tabTo('.reaction-form [data-scope="popover"][data-part="trigger"]');
    await browser("press", "Enter");
    await wait("document.activeElement?.matches('.app-combobox-input')");
    await type("Exact recipient");
    await wait("document.querySelectorAll('.choice-picker [role=option]').length === 1");
    await browser("press", "ArrowDown");
    await browser("press", "Enter");
    await wait("!document.querySelector('.choice-picker')");
    const instruction = "exact first line\n second line 🧭 ";
    await field('.reaction-form textarea', instruction);

    if (kind === "instant" || kind === "pr-checks") {
      await tabTo('.reaction-form .app-select-trigger[aria-label="Condition"]');
      await browser("press", "Enter");
      await wait("!!document.querySelector('.app-select-list')");
      await browser("press", "Home");
      await browser("press", "ArrowDown");

      if (kind === "instant") await browser("press", "ArrowDown");
      await browser("press", "Enter");
      await wait("!document.querySelector('.app-select-list')");
    }

    if (kind === "instant") {
      await wait("!!document.querySelector('.reaction-when[aria-label=At]')");
      await field('.reaction-when[aria-label=At] input[data-part=input]', "2098-01-01");
      await field('.reaction-when[aria-label=At] [data-scope=field] input', "09:00");
      await tabTo('.reaction-when[aria-label=At] .app-select-trigger');
      await browser("press", "Enter");
      await wait("!!document.querySelector('.app-select-list')");
      await browser("press", "Home");

      for (let step = 0; step < 7; step++) await browser("press", "ArrowDown");
      await browser("press", "Enter");
      await wait("!document.querySelector('.app-select-list')");
    } else if (kind === "pr-checks") {
      await field('.reaction-form input[placeholder="github.com/owner/name"]', "github.com/acme/keyboard");
      await field('.reaction-form [data-scope=number-input] input', "23");
    } else {
      await tabTo(`.reaction-agents input[value="${agents[1]!.id}"]`);
      await browser("press", "Space");
      await tabTo(`.reaction-agents input[value="${agents[2]!.id}"]`);
      await browser("press", "Space");

      if (kind === "any") {
        await tabTo('.app-radio input[value="all"]');
        await browser("press", "ArrowRight");
      }
    }

    await field('.reaction-when[aria-label=Expires] input[data-part=input]', "2099-01-01");
    await field('.reaction-when[aria-label=Expires] [data-scope=field] input', "09:00");
    await wait("!document.querySelector('.reaction-form button[type=submit]').disabled");
    expect(await evaluate("window.__reactionCalls.filter(call => call.method === 'reaction.create')")).toHaveLength(0);

    if (dir) {
      await mkdir(dir, { recursive: true });
      await browser("screenshot", join(dir, `keyboard-${kind}.png`));
      await writeFile(join(dir, `keyboard-${kind}.checks.json`), JSON.stringify(await evaluate("window.__checks()")));
    }

    await tabTo('.reaction-form button[type=submit]');
    await browser("press", "Enter");
    await wait("!!document.querySelector('.reaction-detail') || !!document.querySelector('.reaction-form [role=alert]')");
    expect(await evaluate("document.querySelector('.reaction-form [role=alert]')?.textContent ?? null")).toBeNull();
    const listed = await app.rpc("reaction.list", null);
    expect(listed).toHaveLength(1);
    const saved = await app.rpc("reaction.get", { id: listed[0]!.id });
    expect(saved).toMatchObject({ target: agents[0]!.id, instruction, max_firings: 1, expires_at: "2099-01-01T09:00:00Z" });
    expect(saved.condition).toEqual(kind === "instant" ? { kind: "instant", at: "2098-01-01T09:00:00+05:30", late: "once-before-expiry" } : kind === "pr-checks" ? { kind: "pr-checks", repository: "github.com/acme/keyboard", number: 23 } : { kind: "agents", ids: [agents[1]!.id, agents[2]!.id], any: kind === "any" });
    expect(await evaluate("window.__reactionCalls.filter(call => call.method === 'reaction.create')")).toHaveLength(1);
    expect(await evaluate("window.__reactionCalls.filter(call => call.method === 'reaction.run')")).toHaveLength(0);

    if (kind === "pr-checks") expect(saved.observation.pinned_head).toBe("1111111111111111111111111111111111111111");

    if (kind === "instant") expect(await evaluate("window.__reactionCalls.filter(call => call.method === 'reaction.preview').map(call => call.params)")).toContainEqual({ date: "2098-01-01", time: "09:00", offset: "+05:30" });
    await tabTo('.reaction-back');
    await browser("press", "Enter");
    await wait("document.activeElement?.matches('[data-reaction-opener=create]')");
    await tabTo(`[data-reaction-opener="${saved.id}"]`);
    await browser("press", "Enter");
    await wait("document.activeElement?.matches('.reaction-back')");
    await browser("press", "Enter");
    await wait(`document.activeElement?.matches('[data-reaction-opener="${saved.id}"]')`);
  } finally { await close(); await real.stop(); await rm(forge, { recursive: true, force: true }); }
}, 60_000);

it.skipIf(!captureDir("U3787c")).each(["agents-10", "tree-40", "tabs-8", "conflict"])("u3787c_reactions_list_rendered_%s", async seed => {
  const { browser, evaluate, wait, close } = await reactionBrowser();
  const server = await appServer();
  const dir = captureDir("U3787c")!;
  const daemon = "window.__fake.app.of(document.querySelector('.project-tab[data-selected=true]').dataset.path)";

  await mkdir(dir, { recursive: true });

  const capture = async (step: string) => {
    const checks: Checks = await evaluate("window.__checks()");
    await writeFile(join(dir, `reactions-${seed}-${step}.checks.json`), JSON.stringify(checks));
    await browser("screenshot", join(dir, `reactions-${seed}-${step}.png`));

    return checks;
  };

  try {
    await browser("record", "start", join(dir, `reactions-${seed}.webm`));
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("open", `${server.resolvedUrls!.local[0]}harness.html?seed=${seed}`);
    await wait("!!window.__fake && !!document.querySelector('.project-tab[data-selected=true]')");
    await evaluate(`(() => {
      const app = ${daemon};
      const records = Array.from({ length: 5 }, (_, at) => ({
        project:'p',id:'keys-'+at,name:at<2?'café é 🧭':'Très long é 🧭 '.repeat(8),actor:{kind:'user',id:'you',parent:null},home:null,target:'agent-1',
        instruction:'Review changes',condition:{kind:'agents',ids:['agent-1'],any:false},max_firings:1,remaining:1,rearm:false,
        expires_at:'2099-01-01T09:00:00Z',created_at:'2026-10-20T09:00:00Z',state:'active',
        observation:{health:'observing',health_code:'observing',cause_code:'unknown',gap_code:'unknown',recovery_code:'unknown',cursor:null,gap:null,recovery:null,evidence:null},firings:[]
      }));
      app.handlers['reaction.list'] = () => records;
      app.handlers['reaction.get'] = ({id}) => records.find(record => record.id === id);
      window.dispatchEvent(new CustomEvent('open-project-page',{detail:{path:document.querySelector('.project-tab[data-selected=true]').dataset.path,command:'view:reactions'}}));
      window.dispatchEvent(new Event('focus'));
      return true;
    })()`);
    await wait("document.querySelectorAll('.reaction-row').length === 5");
    const before = await capture("before");
    await evaluate(`${daemon}.calls.length = 0`);
    await browser("focus", ".reaction-row");
    await browser("press", "End");
    expect(await evaluate("document.activeElement.dataset.reactionOpener")).toBe("keys-4");
    await browser("press", "ArrowDown");
    expect(await evaluate("document.activeElement.dataset.reactionOpener")).toBe("keys-4");
    await browser("press", "Home");
    expect(await evaluate("document.activeElement.dataset.reactionOpener")).toBe("keys-0");
    await capture("focus");
    await browser("press", "Meta+a");
    expect(await evaluate("document.querySelectorAll('.reaction-row[data-row-selected=true]').length")).toBe(5);
    expect(await evaluate(`${daemon}.calls`)).toEqual([]);
    const selected = await capture("selected");
    await browser("press", "Enter");
    await wait("!!document.querySelector('.reaction-detail')");
    await browser("click", ".reaction-back");
    await wait("document.activeElement?.matches('[data-reaction-opener=keys-0]')");
    expect(await evaluate("document.querySelectorAll('.reaction-row[data-row-selected=true]').length")).toBe(5);
    await evaluate(`(() => {
      ${daemon}.handlers['reaction.list'] = () => { throw new Error('Restore Project access, then Retry to load reactions.'); };
      window.dispatchEvent(new Event('focus'));
      return true;
    })()`);
    await wait("document.querySelector('.reactions [role=alert]')?.textContent.includes('Restore Project access')");
    const failed = await capture("failure");

    for (const id of CHECK_IDS) if (before[id].status === "pass") {
      expect(selected[id].status, id).toBe("pass");
      expect(failed[id].status, id).toBe("pass");
    }
  } finally {
    try { await browser("record", "stop"); }
    finally { await close(); }
  }
}, 60_000);
