import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

const profile = mkdtempSync(join(tmpdir(), "u3768-"));

const session = `u3768-${process.pid}`;

let server: AppServer;

const browser = async (...args: string[]) => {
  try {
    return (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 })).stdout;
  } catch (error) {
    if (error instanceof Error && "stdout" in error) throw new Error(`${String(error)}\n${String(error.stdout)}`);
    throw error;
  }
};

const read = async <T,>(expression: string): Promise<T> => {
  // SAFETY: agent-browser owns this envelope; expressions below return the declared data.
  const reply = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

  if (!reply.success) throw new Error(reply.error);

  return reply.data.result;
};

const wait = async (expression: string) => browser("wait", "--fn", expression);

const open = async (seed: string) => {
  await browser("open", new URL(`/harness.html?seed=${seed}`, process.env.ROUNDUP_TIMELINE_ORIGIN ?? server.resolvedUrls.local[0]!).href);
  await browser("set", "media", "dark");
  await wait("!!window.__fake && !!document.querySelector('[role=treeitem]')");
};

const capture = async (name: string) => {
  const checks = await read("window.__checks()");

  for (const id of ["U3768a", "U3768b", "U3768h"]) {
    const dir = captureDir(id);

    if (!dir) continue;
    const folder = join(dir, process.env.ROUNDUP_TIMELINE_ORIGIN ? "base" : "head");

    mkdirSync(folder, { recursive: true });
    await browser("screenshot", join(folder, `${name}.png`));
    writeFileSync(join(folder, `${name}.checks.json`), JSON.stringify(checks, null, 2));
  }
};

const select = async (id: string) => {
  await browser("click", `[role=treeitem][data-id="${id}"]`);
  await wait("!!Array.from(document.querySelectorAll('button')).find(e => e.textContent === 'Timeline')");
  await browser("find", "role", "button", "click", "--name", "Timeline", "--exact");
  await wait("!!document.querySelector('.timeline-view')");
};

beforeAll(async () => {
  server = await appServer();
  await browser("--profile", profile, "open", new URL("/harness.html?seed=door-stopped", server.resolvedUrls.local[0]!).href);
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close(); rmSync(profile, { recursive: true, force: true }); }
});

it("u3768h_recorded_work_survives_stop_and_return_on_the_rendered_app", async () => {
  await open("door-stopped");
  const videoDir = captureDir("U3768h");

  if (videoDir) {
    mkdirSync(videoDir, { recursive: true });
    await browser("record", "start", join(videoDir, process.env.ROUNDUP_TIMELINE_ORIGIN ? "before.webm" : "after.webm"));
    await browser("set", "media", "dark");
    await wait("!!window.__fake && !!document.querySelector('[role=treeitem]')");
  }

  await read(`(() => {
    const now = Date.now();
    for (const [kind, ago] of [['working', 28], ['needs-you', 16], ['working', 13], ['error', 5]]) {
      window.__fake.emit({ actor: { kind: 'user', id: 'you', parent: null }, name: 'agent.status', data: { id: 'first-workstream', attempt: '1', status_revision: String(30 - ago), ended: kind === 'error', status: { kind, label: kind === 'error' ? 'Tests failed; restart the supervisor to retry' : kind, since: now - ago * 60000 } } });
    }
  })()`);

  await select("first-workstream");
  await capture("single-stopped-door");
  const before = await read<number[]>("Array.from(document.querySelectorAll('.timeline-block')).map(e => Number(e.dataset.end))");
  await browser("click", ".timeline-header button");
  await wait("!document.querySelector('.timeline-view')");
  await browser("find", "role", "button", "click", "--name", "Timeline", "--exact");
  await wait("!!document.querySelector('.timeline-view')");

  for (const key of ["Enter", "Space"]) {
    await browser("focus", ".timeline-header button");
    await browser("press", key);
    await wait("!document.querySelector('.timeline-view')");
    expect(await read("document.activeElement === Array.from(document.querySelectorAll('button')).find(e => e.textContent === 'Timeline')")).toBe(true);
    await browser("find", "role", "button", "click", "--name", "Timeline", "--exact");
    await wait("!!document.querySelector('.timeline-view')");
  }

  const after = await read<number[]>("Array.from(document.querySelectorAll('.timeline-block')).map(e => Number(e.dataset.end))");

  await open("tree-40");
  await read(`(async () => {
    await window.__fake.app.rpc('rail.rename', { id: 'agent-4', name: 'A'.repeat(60) });
    window.__fake.setStatus('payments', 'error', 'Tests failed; restart the supervisor to retry');

  })()`);
  await wait("document.querySelector('[data-id=agent-4]').textContent.includes('AAAA')");
  await read("window.__fake.failNext(-32000, 'Cannot load work: connection lost; retry')");
  await select("payments");
  await capture("dense-subagents-failure");
  expect(await read<number>("document.querySelectorAll('.timeline-lane').length")).toBeGreaterThan(1);

  await read(`(() => {
    const actor = { kind: 'user', id: 'you', parent: null };
    window.__fake.emit({ actor, name: 'agent.status', data: { id: 'agent-4', attempt: '1', status_revision: '50', status: { kind: 'needs-you', label: 'Approve the test run', since: Date.now() - 8 * 60000 } } });
  })()`);
  await wait("!!document.querySelector('button.timeline-block')");
  await browser("focus", "button.timeline-block");
  await capture("dense-needs-you-focus");
  await browser("press", "Enter");
  await wait("!document.querySelector('.timeline-view')");

  if (videoDir) await browser("record", "stop");
  expect(after).toEqual(before);
}, 90_000);
