import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import { agentBrowserExecutable } from "../testing/chromePage";
import { captureDir } from "../testing/captures";
import type { Checks } from "../testing/checks";
import { copy } from "./copy";

const exec = promisify(execFile);

const SIZE = { wide: 1512, centre: 388, height: 950 };

const AGENT = "/p/.roundup/agent-1";

const said = (words: string) => `document.querySelector('.changes-view')?.textContent.includes(${JSON.stringify(words)})`;

const CAUSE = "remote_unreachable: ssh: Could not resolve hostname git.example.com: Name or service not known";

// U7693d: `just capture U7693d` writes the chip moved, fetching, fetched and failed at 1512 by 950 and at the centre's 388 px minimum, dark, over the U26 harness; the design critic judges layout and looks.
it("u7693d_the_chip_is_captured_for_the_critic", async () => {
  const directory = captureDir("U7693d");

  if (!directory) return;

  const server = await appServer();
  const session = `changes-remote-${process.pid}`;
  const profile = mkdtempSync(join(tmpdir(), "changes-remote-"));
  const browser = async (...args: string[]) => (await exec(agentBrowserExecutable, ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })).stdout;

  const read = async <T,>(expression: string): Promise<T> => {
    // SAFETY: agent-browser wraps these constant DOM expressions in its JSON envelope.
    const result = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };

  const until = (expression: string) => browser("wait", "--fn", expression);

  const shots: { name: string; checks: Checks }[] = [];
  let lane = "";

  /** Waits for `ready`, then writes `<lane>-<name>.png` and its Checks. */
  const shot = async (state: string, ready: string) => {
    const name = `${lane}-${state}`;

    await until(ready);
    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, `${name}.png`));

    const checks = await read<Checks>("window.__checks()");

    writeFileSync(join(directory, `${name}.checks.json`), JSON.stringify(checks, null, 2));
    shots.push({ name, checks });
  };

  /** A fresh page whose remote answers `remote` and whose Fetch answers `fetch` (JS expressions), the Changes view open on its first read. */
  const opened = async (remote: string, fetch: string) => {
    await browser("open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
    await until("!!window.__fake && !!document.querySelector('.changes-icon')");
    await read(`(() => {
      const handlers = window.__fake.app.handlers;

      handlers["agent.remoteMain"] = ${remote};
      handlers["agent.fetchRemoteMain"] = ${fetch};
      handlers["agent.ownedChanges"] = () => ({ groups: [{ repo: ${JSON.stringify(AGENT)}, branch: "roundup/agent-1", base: "main", files: [{ path: "src/a.ts", status: "modified", line: 1, counts: { added: 1, removed: 1 }, blob: null }] }] });
      window.__fake.setStatus("agent-1", "idle", "ready");

      return window.__worktrees.refresh("agent-1").then(() => true);
    })()`);
    await until("document.querySelector('.rail-row[data-id=\"agent-1\"] .changes-icon .changes-count')?.textContent === '1'");
    await browser("click", ".changes-icon");
    await until("!!document.querySelector('.changes-view .changes-side')");
  };

  const click = (name: string) => browser("find", "role", "button", "click", "--name", name, "--exact");

  const moved = "() => ({ kind: 'moved' })";

  const states: { run: () => Promise<void> }[] = [
    { run: async () => { await opened(moved, "() => ({ commits: 2 })"); await shot("moved", said(copy.remoteMoved)); } },
    { run: async () => { await opened(moved, "() => new Promise(() => {})"); await until(said(copy.remoteMoved)); await click(copy.fetch); await shot("fetching", said(copy.fetching)); } },
    { run: async () => { await opened(moved, "() => ({ commits: 2 })"); await until(said(copy.remoteMoved)); await click(copy.fetch); await shot("fetched", said(copy.fetched(2))); } },
    { run: async () => { await opened(`() => { throw new Error(${JSON.stringify(CAUSE)}); }`, "() => ({ commits: 0 })"); await shot("failed", said(copy.remoteUnreachable)); } },
  ];

  try {
    await browser("--profile", profile, "open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
    await browser("set", "media", "dark");
    await browser("set", "viewport", String(SIZE.wide), String(SIZE.height));
    await until("!!window.__fake && !!document.querySelector('.changes-icon')");
    await browser("click", ".changes-icon");
    await until("!!document.querySelector('.changes-view .changes-side')");

    // The width that leaves the view the centre's minimum: the wide window less what the view has over it.
    const view = await read<number>("document.querySelector('.changes-view').getBoundingClientRect().width");
    const lanes = [["wide", SIZE.wide], ["centre", SIZE.wide - Math.max(0, Math.floor(view) - SIZE.centre)]] as const;

    for (const [name, width] of lanes) {
      lane = name;
      await browser("set", "viewport", String(width), String(SIZE.height));

      for (const state of states) await state.run();
    }
  } finally {
    try { await browser("close"); }
    finally { rmSync(profile, { recursive: true, force: true }); await server.close(); }
  }

  // D2, D5 and D6 hold on every state (U7693d); every capture is written before one fails the run.
  expect(shots.flatMap(each => [each.checks.D2, each.checks.D5, each.checks.D6].some(check => check.status !== "pass") ? [each.name] : [])).toEqual([]);
}, 300_000);
