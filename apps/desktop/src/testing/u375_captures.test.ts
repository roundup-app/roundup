import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";
import { createServedApp } from "./realSeam";
import { startRealDaemon } from "./realDaemonFixture";
import type { StartedDaemon } from "./realDaemonFixture";

/** The real `rupd` in a real Chromium: U2567c's attention capture. */

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

it("u2567c_real_daemon_attention_opens_its_agents_terminal", async () => {
  const app = createServedApp(real.base);
  const workstream = await app.rpc("rail.createWorkstream", { name: "review", parent: null });
  const agent = await app.rpc("agent.spawn", { cwd: real.dir, parent: workstream.id, prompt: null, order: { kind: "clarification", question: "What should I review?" }, name: "reviewer" });

  await app.rpc("agent.signal", { id: agent.id, attempt: agent.attempt!, payload: { hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "git status" } } });
  await page.load(`${real.base}/harness.html?daemon=1`, 1512, 950);
  await page.until(`() => Boolean(document.querySelector('.rail [data-todo-root]'))`);
  await page.call(`() => document.querySelector('.rail [data-todo-root]').click()`);
  await page.until(`() => [...document.querySelectorAll('.overview-attention .overview-entry')].some((entry) => entry.textContent === 'reviewer' && entry.querySelector('[role=img]')?.getAttribute('aria-label') === 'Needs-you')`);

  const names = await page.call<string[][]>(`() => [...document.querySelectorAll('.overview-list > li')].map((entry) => [...entry.querySelectorAll('.overview-entry')].map((button) => [button.querySelector('.overview-name').textContent, button.querySelector('[role=img]')?.getAttribute('aria-label')].filter(Boolean).join(' ')))`);

  expect(names).toContainEqual(["review Done", "reviewer Needs-you"]);
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
