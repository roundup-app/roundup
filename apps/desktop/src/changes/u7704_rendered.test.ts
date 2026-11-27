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

// Lines 6 and 22 change in every file.
const body = (tag: string) => Array.from({ length: 30 }, (_, n) => "  const value" + n + " = " + n + (n === 5 || n === 21 ? tag : "") + ";").join("\n") + "\n";

const COMPARISON: FileComparison = { base: "base", oldPath: "", newPath: "", status: "modified", old: text("o", body("")), new: text("n", body(" + 1")) };

// The 14-module fixture of U7679f.
const path = (n: number) => "crates/module-" + String(n).padStart(2, "0") + "/src/lib.rs";

const FILES = Array.from({ length: 14 }, (_, n) => file(path(n + 1)));

const repeat = { source: { kind: "repeats" }, path: path(1), start: 12, end: 14, other: { path: path(2), start: 12, end: 14 }, stale: false };

// Two tools on the first module: a spot at rest, an Outdated one, and one past the last line that the group at the end lists.
const SPOTS = [
  { source: { kind: "tool", name: "oxlint" }, path: path(1), start: 6, end: 7, message: "unused variable", stale: false },
  { source: { kind: "tool", name: "tests" }, path: path(1), start: 20, end: 21, message: "fails here", stale: true },
  { source: { kind: "tool", name: "oxlint" }, path: path(1), start: 40, end: 45, message: "past the last line", stale: false },
];

const said = (words: string) => "document.querySelector('.changes-view')?.textContent.includes(" + JSON.stringify(words) + ")";

// U7704h: `just capture U7704h` writes each state at 1512 by 950, dark, over the U26 harness; the design critic judges layout and looks.
it("u7704h_the_spots_are_captured_for_the_critic", async () => {
  const directory = captureDir("U7704h");

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

  /** The Daemon answers with the listing of the Tree target, each file's comparison, the repeat and the tools' spots: "done" or "failed". */
  const serve = (mode: "done" | "failed") => {
    const groups = [{ repo: "/p/transform-education", branch: "main", base: "main", files: FILES }];

    return read(`(() => {
      const handlers = window.__fake.app.handlers;

      handlers["agent.ownedChanges"] = () => ({ groups: ${JSON.stringify(groups)} });
      handlers["agent.changedFiles"] = () => ({ files: ${JSON.stringify(FILES)} });
      handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path });
      handlers["agent.repeatScan"] = () => ({ spots: [${JSON.stringify(repeat)}], complete: true });
      handlers["agent.spots"] = () => {
        if (${JSON.stringify(mode)} === "failed") throw Object.assign(new Error("failed: the spots could not be read"), { code: -32603 });

        return { spots: ${JSON.stringify(SPOTS)} };
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
  const opened = async (mode: "done" | "failed") => {
    await serve(mode);
    await until("!!document.querySelector('.changes-icon')");
    await browser("click", ".changes-icon");
    await until("!!document.querySelector('.changes-view .changes-side [data-row=\"module\"]')");
    await browser("click", ".changes-view .app-segment[aria-label=\"Tree\"]");
  };

  const open = async () => { await browser("click", '.changes-side [data-row="module"]'); await until("!!document.querySelector('.spot-mark')"); };

  const states: { name: string; mode: "done" | "failed"; run: () => Promise<void> }[] = [
    { name: "marks", mode: "done", run: async () => { await open(); await shot("marks", said("2 from oxlint")); } },
    { name: "outdated", mode: "done", run: async () => { await open(); await shot("outdated", "!!document.querySelector('.spot-mark[data-stale]')"); } },
    { name: "unshown", mode: "done", run: async () => { await open(); await shot("unshown", "!!document.querySelector('.diff-reader .note-group')"); } },
    { name: "failed", mode: "failed", run: () => shot("failed", said("Couldn't read spots")) },
  ];

  try {
    // Each state is a session of its own: a page that opened the view four times stops answering.
    for (const state of states) {
      session = "changes-spots-" + process.pid + "-" + state.name;
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
