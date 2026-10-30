import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
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

it.skipIf(!captureDir("NR9"))("nr9_agent_overview_rendered", async () => {
  const { browser, evaluate, wait, close } = await reactionBrowser();
  const server = await appServer();
  const phase = process.env.ROUNDUP_CAPTURE_PHASE ?? "head";
  const dirs = ["NR9", "U4276a", "U4276b", "U4276c"].map(id => join(captureDir(id)!, phase));
  for (const dir of dirs) await mkdir(dir, { recursive: true });
  const capture = async (step: string) => {
    const checks: Checks = await evaluate("window.__checks()");
    for (const dir of dirs) {
      await writeFile(join(dir, `${step}.checks.json`), JSON.stringify(checks));
      await browser("screenshot", join(dir, `${step}.png`));
    }
    for (const id of ["D2", "D5", "D6"] as const) expect(checks[id], `${step} ${id}`).toMatchObject({ status: "pass" });
  };
  try {
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("record", "start", join(dirs[0]!, "overview.webm"));
    await browser("open", `${server.resolvedUrls.local[0]}harness.html?seed=agents-10`);
    await wait("!!window.__fake && !!document.querySelector('.project-tab[data-selected=true]')");
    await evaluate(`(() => {
      const path = document.querySelector('.project-tab[data-selected=true]').dataset.path;
      const app = window.__fake.app.of(path);
      window.__nr9 = { app, records: [] };
      app.handlers['reaction.list'] = () => window.__nr9.records;
      app.handlers['reaction.get'] = ({id}) => window.__nr9.records.find(r => r.id === id);
      window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path, command:'view:reactions'}}));
      window.dispatchEvent(new Event('focus'));
    })()`);
    await wait("!!document.querySelector('.reactions .overview-quiet')");
    await capture("empty");
    await evaluate(`(() => {
      window.__nr9.records = ['active', 'stopped', 'expired', 'active'].map((state, i) => ({
        project:'p', id:'nr9-'+i, name:i < 2 ? 'Review overlapping changes' : 'Review long overlapping changes '.repeat(5),
        actor:{kind:'agent', id:'agent-'+(i+1), parent:null}, reason:i === 2 ? null : 'Wait for the prerequisite review before continuing',
        home:null, target:'agent-2', instruction:'Review the saved changes and update the changelog',
        condition:{kind:'agents',ids:['agent-3'],any:false},max_firings:2,remaining:2,rearm:true,
        expires_at:'2099-01-01T09:00:00Z',created_at:'2026-10-20T09:00:00Z',state,
        observation:{health:i === 3 ? 'unavailable' : 'observing',health_code:i === 3 ? 'unavailable' : 'observing',cause_code:i === 3 ? 'agent-unavailable' : 'unknown',gap_code:'unknown',recovery_code:i === 3 ? 'replace-agent' : 'unknown',cursor:null,gap:null,recovery:null,evidence:null},firings:[]
      }));
      window.dispatchEvent(new Event('focus'));
    })()`);
    await wait("document.querySelectorAll('.reaction-row').length === 4");
    await capture("filled-long-stopped");
    await browser("click", "[data-reaction-opener=nr9-3]");
    await wait("!!document.querySelector('.reaction-detail [role=alert]')");
    await capture("unavailable");
    await browser("click", ".reaction-back");
    await wait("!!document.querySelector('[data-reaction-opener=nr9-0]')");
    await browser("click", "[data-reaction-opener=nr9-0]");
    await wait("!!document.querySelector('.reaction-detail')");
    for (const [method, label] of [["reaction.run", "Run now"], ["reaction.stop", "Stop"]]) {
      await evaluate(`window.__nr9.app.handlers['${method}'] = () => { throw new Error('Project access was refused. Restore access, then try ${label} again.'); }`);
      await evaluate(`[...document.querySelectorAll('.reaction-actions button')].find(b => b.textContent === '${label}').click()`);
      await wait("!!document.querySelector('.reaction-detail [role=alert]') && !document.querySelector('.reaction-actions button:disabled')");
      await capture(`${method}-refused`);
      await evaluate(`window.__nr9.app.handlers['${method}'] = ({id}) => window.__nr9.records.find(r => r.id === id)`);
      await evaluate(`[...document.querySelectorAll('.reaction-actions button')].find(b => b.textContent === '${label}').click()`);
      await wait("!document.querySelector('.reaction-detail [role=alert]') && !document.querySelector('.reaction-actions button:disabled')");
      await capture(`${method}-recovered`);
    }
  } finally {
    try { await browser("record", "stop"); }
    finally { await close(); await server.close(); }
  }
}, 120_000);
