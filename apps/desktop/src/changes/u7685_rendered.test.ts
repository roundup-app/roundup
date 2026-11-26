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

const SIZE = { wide: 1512, height: 950 };

const file = (path: string): ChangedFile => ({ path, status: "modified", line: 1, counts: { added: 3, removed: 2 }, blob: null });

const text = (revision: string, body: string) => ({ kind: "text", revision, text: body }) as const;

// Lines 6 and 22 change in every file; a repeat covers lines 6 to 8.
const body = (tag: string) => Array.from({ length: 30 }, (_, n) => "  const value" + n + " = " + n + (n === 5 || n === 21 ? tag : "") + ";").join("\n") + "\n";

const COMPARISON: FileComparison = { base: "base", oldPath: "", newPath: "", status: "modified", old: text("o", body("")), new: text("n", body(" + 1")) };

// The 14-module fixture of U7679f.
const path = (n: number) => "crates/module-" + String(n).padStart(2, "0") + "/src/lib.rs";

const FILES = Array.from({ length: 14 }, (_, n) => file(path(n + 1)));

// Modules 1 to 3 repeat lines of the module after them, so the open module is marked and three rows count.
const HITS = [1, 2, 3].map(n => ({ source: { kind: "repeats" }, path: path(n), start: 6, end: 8, other: { path: path(n + 1), start: 12, end: 14 }, stale: false }));

const said = (words: string) => "document.querySelector('.changes-view')?.textContent.includes(" + JSON.stringify(words) + ")";

const MARKED = "!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line][data-spot]') && !!document.querySelector('.repeat-mark button')";

// U7685h: `just capture U7685h` writes each state at 1512 by 950, dark, over the U26 harness; the design critic judges layout and looks.
it("u7685h_the_repeats_are_captured_for_the_critic", async () => {
  const directory = captureDir("U7685h");

  if (!directory) return;

  const server = await appServer();
  const shots: { name: string; checks: Checks }[] = [];
  let session = "";

  const browser = async (...args: string[]) => (await exec(agentBrowserExecutable, ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })).stdout;

  const read = async <T,>(expression: string): Promise<T> => {
    // SAFETY: agent-browser wraps these constant DOM expressions in its JSON envelope.
    const result = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };

  const until = (expression: string) => browser("wait", "--fn", expression);

  /** The Daemon answers with the listing of the Tree target, each file's comparison and the scan: "done", "slow" (never answers) or "failed". */
  const serve = (mode: "done" | "slow" | "failed") => {
    const groups = [{ repo: "/p/transform-education", checkout: "/p/transform-education", branch: "main", base: "main", files: FILES }];

    return read(`(() => {
      const handlers = window.__fake.app.handlers;

      handlers["agent.ownedChanges"] = () => ({ groups: ${JSON.stringify(groups)} });
      handlers["agent.changedFiles"] = () => ({ files: ${JSON.stringify(FILES)} });
      handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path });
      handlers["agent.repeatScan"] = () => {
        if (${JSON.stringify(mode)} === "slow") return new Promise(() => {});
        if (${JSON.stringify(mode)} === "failed") throw Object.assign(new Error("failed: the scan could not read the Worktree"), { code: -32603 });

        return { spots: ${JSON.stringify(HITS)}, complete: true };
      };
      window.__fake.setStatus("agent-1", "idle", "ready");

      return window.__worktrees.refresh("agent-1").then(() => true);
    })()`);
  };

  const shot = async (state: string, ready: string) => {
    await until(ready);
    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, state + ".png"));

    const checks = await read<Checks>("window.__checks()");

    writeFileSync(join(directory, state + ".checks.json"), JSON.stringify(checks, null, 2));
    shots.push({ name: state, checks });
  };

  /** The Changes view over the Tree target: the Daemon answers first, then the icon opens the view. */
  const opened = async (mode: "done" | "slow" | "failed") => {
    await serve(mode);
    await until("!!document.querySelector('.changes-icon')");
    await browser("click", ".changes-icon");
    await until("!!document.querySelector('.changes-view .changes-side [data-row=\"overview\"]')");
    await browser("click", ".changes-view .app-segment[aria-label=\"Tree\"]");
  };

  const states: { name: string; mode: "done" | "slow" | "failed"; run: () => Promise<void> }[] = [
    { name: "marks", mode: "done", run: async () => { await browser("click", '.changes-side [data-row="module"]'); await shot("marks", MARKED + " && " + said("1 repeat")); } },
    { name: "place", mode: "done", run: async () => { await browser("click", '.changes-side [data-row="module"]'); await until(MARKED); await browser("click", ".repeat-mark button"); await shot("place", "!!document.querySelector('.repeat-excerpt')"); } },
    { name: "scanning", mode: "slow", run: () => shot("scanning", said("Checking for repeats")) },
    { name: "failed", mode: "failed", run: () => shot("failed", said("Couldn't check repeats")) },
  ];

  try {
    // Each state is a session of its own: a page that opened the view four times stops answering.
    for (const state of states) {
      session = "changes-repeats-" + process.pid + "-" + state.name;
      await browser("open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
      await browser("set", "media", "dark");
      await browser("set", "viewport", String(SIZE.wide), String(SIZE.height));
      await until("!!window.__fake && !!document.querySelector('.changes-icon')");
      await opened(state.mode);
      await state.run();
      await browser("close");
    }
  } finally {
    await server.close();
  }

  expect(shots.flatMap(each => [each.checks.D2, each.checks.D5, each.checks.D6].some(check => check.status !== "pass") ? [each.name] : [])).toEqual([]);
}, 900_000);
