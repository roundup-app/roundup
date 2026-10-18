import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

/** U375's rendered observer: the real `rupd`, a Subagent selected in Watch and then in a Takeover, in a real Chromium at 1280×800. */

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let real: StartedDaemon;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U375 needs a Chrome binary: set CHROME_PATH");

  real = await startRealDaemon({}, true);
  page = await openPage(found);
}, 300_000);

afterAll(async () => {
  await page?.close();
  await real?.stop();
});

run("u375 on the real Daemon", () => {
  vi.setConfig({ testTimeout: 120_000 });

  it("u375_a_subagent_shows_managed_and_then_you_control", async () => {
    const app = createServedApp(real.base);

    await app.rpc("rail.createWorkstream", { name: "scope", parent: null });

    const door = (await app.rpc("rail.tree", null)).find((node) => node.kind === "workstream")!;
    const sub = await app.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: door.id });

    await page.load(`${real.base}/harness.html?daemon=1`, 1280, 800);
    await page.until(`() => [...document.querySelectorAll("*")].some((each) => each.children.length === 0 && each.textContent.trim() === ${JSON.stringify(sub.name)})`, 30_000);
    await page.call(`(name) => [...document.querySelectorAll("*")].filter((each) => each.children.length === 0 && each.textContent.trim() === name).at(-1).click()`, sub.name);
    await page.until(`() => /Managed/.test(document.body.textContent)`, 30_000);

    const terminal = sub.terminal_id!;
    const received = async () => (await app.rpc("terminal.snapshot", { id: terminal })).after;
    const before = await received();

    for (const [key, code] of [["h", "KeyH"], ["i", "KeyI"], ["Enter", "Enter"]] as const) await page.press(key, code);

    await new Promise((done) => setTimeout(done, 2_000));
    expect(await received()).toBe(before);

    await page.call(`() => [...document.querySelectorAll("button")].find((each) => each.textContent.trim().startsWith("Take control")).click()`);
    await page.until(`() => /You control/.test(document.body.textContent)`, 30_000);
    expect(await page.call<boolean>(`() => !/read-only/.test(document.body.textContent)`)).toBe(true);

    const watched = await received();

    for (const [key, code] of [["h", "KeyH"], ["i", "KeyI"], ["Enter", "Enter"]] as const) await page.press(key, code);

    for (let waited = 0; (await received()) === watched; waited += 250) {
      if (waited >= 15_000) throw new Error("the Subagent's Terminal received nothing after the control");

      await new Promise((done) => setTimeout(done, 250));
    }

  });

it("u2567c_real_daemon_attention_opens_its_agents_terminal", async () => {
  const app = createServedApp(real.base);
  const workstream = await app.rpc("rail.createWorkstream", { name: "review", parent: null });
  const agent = await app.rpc("agent.spawn", { cwd: real.dir, parent: workstream.id, prompt: null, order: { kind: "clarification", question: "What should I review?" }, name: "reviewer" });

  await app.rpc("agent.signal", { id: agent.id, attempt: agent.attempt!, payload: { hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "git status" } } });
  await page.load(`${real.base}/harness.html?daemon=1`, 1512, 950);
  await page.until(`() => Boolean(document.querySelector('.todo-project-root'))`);
  await page.call(`() => document.querySelector('.todo-project-root').click()`);
  await page.until(`() => [...document.querySelectorAll('.overview-attention .overview-entry')].some((entry) => entry.textContent === 'reviewerNeeds-you')`);

  const names = await page.call<string[]>(`() => [...document.querySelectorAll('.overview-list > li')].map((entry) => entry.textContent)`);

  expect(names).toContain("reviewDonereviewerNeeds-you");
  await page.call(`() => {
    const fetch = window.fetch;
    window.__overviewReads = [];
    window.fetch = (url, options) => {
      if (typeof options?.body === 'string') {
        const call = JSON.parse(options.body);
        if (call.method === 'terminal.snapshot') window.__overviewReads.push(call.params.id);
      }
      return fetch(url, options);
    };
    [...document.querySelectorAll('.overview-attention .overview-entry')].find((entry) => entry.textContent.includes('reviewer')).click();
  }`);
  await page.until(`() => Boolean(document.querySelector('.pane-screen .xterm'))`);

  expect(await page.call<string[]>(`() => window.__overviewReads`)).toEqual([agent.terminal_id]);
}, 60_000);

});
