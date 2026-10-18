import { waitFor } from "@solidjs/testing-library";
import { afterAll, beforeAll, expect, it } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { startRealDaemon } from "../testing/realDaemonFixture";
import type { StartedDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";

let real: StartedDaemon;

let page: ChromePage;

beforeAll(async () => {
  const chrome = chromePath();

  if (!chrome) throw new Error("U2567 needs isolated headless Chromium");
  real = await startRealDaemon({}, true);
  page = await openPage(chrome);
}, 300_000);

afterAll(async () => {
  await page?.close();
  await real?.stop();
});

it("u2567c_real_daemon_attention_opens_its_agents_terminal", async () => {
  const app = createServedApp(real.base);
  const workstream = await app.rpc("rail.createWorkstream", { name: "review", parent: null });
  const agent = await app.rpc("agent.spawn", { cwd: real.dir, parent: workstream.id, prompt: null, order: { kind: "clarification", question: "What should I review?" }, name: "reviewer" });

  await waitFor(async () => expect((await app.rpc("rail.tree", null)).find((node) => node.id === agent.id)?.status?.kind).toBe("idle"), { timeout: 20_000 });
  await app.rpc("agent.signal", { id: agent.id, attempt: agent.attempt!, payload: { hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "git status" } } });
  await page.load(`${real.base}/harness.html?daemon=1`, 1512, 950);
  await page.until(`() => document.querySelector('.overview-attention .overview-entry')?.textContent.includes('Needs-you')`);

  const names = await page.call<string[]>(`() => [...document.querySelectorAll('.overview-list > li')].map((entry) => entry.textContent)`);

  expect(names).toEqual(["reviewDonereviewerNeeds-you"]);
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
    document.querySelector('.overview-attention .overview-entry').click();
  }`);
  await page.until(`() => Boolean(document.querySelector('.pane-screen .xterm'))`);

  expect(await page.call<string[]>(`() => window.__overviewReads`)).toEqual([agent.terminal_id]);
}, 60_000);
