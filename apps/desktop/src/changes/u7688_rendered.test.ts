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
import type { Readback } from "@contracts/agent/Readback";

const exec = promisify(execFile);

const SIZE = { wide: 1512, narrow: 388, height: 950 };

const file = (path: string): ChangedFile => ({ path, status: "modified", line: 1, counts: { added: 3, removed: 2 }, blob: null });

const text = (revision: string, body: string) => ({ kind: "text", revision, text: body }) as const;

// Lines 6 and 22 change in every file; a repeat covers lines 6 to 8.
const body = (tag: string) => Array.from({ length: 30 }, (_, n) => "  const value" + n + " = " + n + (n === 5 || n === 21 ? tag : "") + ";").join("\n") + "\n";

const COMPARISON: FileComparison = { base: "base", oldPath: "", newPath: "", status: "modified", old: text("o", body("")), new: text("n", body(" + 1")) };

const path = (n: number) => "crates/module-" + String(n).padStart(2, "0") + "/src/lib.rs";

const FILES = Array.from({ length: 6 }, (_, n) => file(path(n + 1)));

const GAP = { path: path(1), said: "added a retry", quote: "const value5 = 5 + 1;", line: 6 };

const ACCOUNT = {
  overview: "Adds a loader and wires every module through it.",
  diagram: "Before\nrun -> load\nAfter\nrun -> cache -> load",
  flows: [],
  modules: [{ module: "module-01", account: "Loads data through a cache." }],
  unplaced: [],
  gaps: [GAP],
};

const READ: Readback = { state: "read", ...ACCOUNT };

const said = (words: string) => "document.querySelector('.changes-view')?.textContent.includes(" + JSON.stringify(words) + ")";

// U7688h: `just capture U7688h` writes each state at 1512 by 950 and at 388 wide, dark, over the U26 harness; the design critic judges layout and looks.
it("u7688h_the_readback_is_captured_for_the_critic", async () => {
  const directory = captureDir("U7688h");

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

  /** The Daemon answers with the listing of the Tree target, each file's comparison and the readback. */
  const serve = (answer: Readback) => {
    const groups = [{ repo: "/p/transform-education", branch: "main", base: "main", files: FILES }];

    return read(`(() => {
      const handlers = window.__fake.app.handlers;

      handlers["agent.ownedChanges"] = () => ({ groups: ${JSON.stringify(groups)} });
      handlers["agent.changedFiles"] = () => ({ files: ${JSON.stringify(FILES)} });
      handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path });
      handlers["agent.readback"] = () => ${JSON.stringify(answer)};
      handlers["agent.readbackStart"] = () => ({ state: "reading" });
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
  const opened = async (answer: Readback) => {
    await serve(answer);
    await until("!!document.querySelector('.changes-icon')");
    await browser("click", ".changes-icon");
    await until("!!document.querySelector('.changes-view .changes-side [data-row=\"overview\"]')");
    await browser("click", ".changes-view .app-segment[aria-label=\"Tree\"]");
  };

  const GAPPED = "!!document.querySelector('.gap-mark')";

  const states: { name: string; width: number; answer: Readback; run: () => Promise<void> }[] = [
    { name: "quiet", width: SIZE.wide, answer: { state: "notRead" }, run: () => shot("quiet", said("Read back changes")) },
    { name: "reading", width: SIZE.wide, answer: { state: "reading" }, run: () => shot("reading", said("Reading back")) },
    { name: "read", width: SIZE.wide, answer: READ, run: () => shot("read", said("Read back from the diff") + " && !!document.querySelector('.readback-figure')") },
    { name: "stale", width: SIZE.wide, answer: { ...READ, state: "stale" }, run: () => shot("stale", said("The diff has changed since the readback")) },
    { name: "failed", width: SIZE.wide, answer: { state: "failed", kind: "badAnswer", cause: "the model answered in prose" }, run: () => shot("failed", said("Couldn't read back these changes")) },
    { name: "module", width: SIZE.wide, answer: READ, run: async () => { await browser("click", '.changes-side [data-row="module"]'); await shot("module", GAPPED + " && " + said("Loads data through a cache.")); } },
    { name: "narrow", width: SIZE.narrow, answer: READ, run: () => shot("narrow", said("Read back from the diff")) },
  ];

  try {
    // Each state is a session of its own: a page that opened the view many times stops answering.
    for (const state of states) {
      session = "changes-readback-" + process.pid + "-" + state.name;
      await browser("open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
      await browser("set", "media", "dark");
      await browser("set", "viewport", String(state.width), String(SIZE.height));
      await until("!!window.__fake && !!document.querySelector('.changes-icon')");
      await opened(state.answer);
      await state.run();
      await browser("close");
    }
  } finally {
    await server.close();
  }

  expect(shots.flatMap(each => [each.checks.D2, each.checks.D5, each.checks.D6].some(check => check.status !== "pass") ? [each.name] : [])).toEqual([]);
}, 900_000);
