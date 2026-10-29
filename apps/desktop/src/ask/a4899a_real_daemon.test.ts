import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Todo } from "@contracts/todo/Todo";
import { expect, it, vi } from "vitest";
import { openLane } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";
import { startRealDaemon } from "../testing/realDaemonFixture";
import { createServedApp } from "../testing/realSeam";

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
