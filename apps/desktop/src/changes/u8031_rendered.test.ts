import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import { agentBrowserExecutable } from "../testing/chromePage";
import { captureDir } from "../testing/captures";
import type { Checks } from "../testing/checks";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { FileComparison } from "@contracts/agent/FileComparison";

const exec = promisify(execFile);

const text = (revision: string, body: string) => ({ kind: "text", revision, text: body }) as const;

const body = (tag: string) => Array.from({ length: 24 }, (_, n) => "  const value" + n + " = " + n + (n === 5 ? tag : "") + ";").join("\n") + "\n";

const COMPARISON: FileComparison = { base: "base", oldPath: "", newPath: "", status: "modified", old: text("o", body("")), new: text("n", body(" + 1")) };

const FILES: ChangedFile[] = Array.from({ length: 30 }, (_, n) => ({ path: "m/src/f" + String(n + 1).padStart(2, "0") + ".ts", status: "modified", line: 1, counts: { added: 1, removed: 1 }, blob: null }));

// U8031d: `just capture U8031d` scrolls one module of 30 files at 1512 by 950 in dark mode, the first screen and after a scroll; the design critic judges looks.
it("u8031d_the_scroll_through_a_long_module_is_captured_for_the_critic", async () => {
  const directory = captureDir("U8031d");

  if (!directory) return;

  const server = await appServer();
  const session = "changes-ahead-" + process.pid;
  const shots: Checks[] = [];

  const browser = async (...args: string[]) => (await exec(agentBrowserExecutable, ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })).stdout;

  const read = async <T,>(expression: string): Promise<T> => {
    // SAFETY: agent-browser wraps these constant DOM expressions in its JSON envelope.
    const result = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };

  const until = (expression: string) => browser("wait", "--fn", expression);

  const shot = async (name: string) => {
    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, name + ".png"));

    const checks = await read<Checks>("window.__checks()");

    writeFileSync(join(directory, name + ".checks.json"), JSON.stringify(checks, null, 2));
    shots.push(checks);
  };

  try {
    await browser("open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
    await browser("set", "media", "dark");
    await browser("set", "viewport", "1512", "950");
    await until("!!window.__fake && !!document.querySelector('.changes-icon')");
    await read(`(() => {
      const handlers = window.__fake.app.handlers;

      handlers["agent.ownedChanges"] = () => ({ groups: [{ repo: "/p/r", checkout: "/p/r", branch: "main", base: "main", files: ${JSON.stringify(FILES)} }] });
      handlers["agent.changedFiles"] = () => ({ files: ${JSON.stringify(FILES)} });
      handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path });
      window.__fake.setStatus("agent-1", "idle", "ready");

      return window.__worktrees.refresh("agent-1").then(() => true);
    })()`);
    await browser("click", ".changes-icon");
    await browser("click", '.changes-side .app-segment[aria-label^="Modules "]');
    await until("!!document.querySelector('.changes-side [data-row=\"module\"]')");
    await browser("click", '.changes-side [data-row="module"]');
    await until("!!document.querySelector('.module-file .diff-content')");
    await shot("dark-wide-top");
    await read("(() => { document.querySelector('.module-scroll').scrollTop = 6000; return true; })()");
    await until("document.querySelector('.module-scroll').scrollTop > 0");
    await shot("dark-wide-scrolled");
    await browser("close");
  } finally {
    await server.close();
  }

  expect(shots.flatMap(each => [each.D2, each.D5, each.D6].filter(check => check.status !== "pass"))).toEqual([]);
}, 600_000);
