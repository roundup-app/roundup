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
import type { DefectFindings } from "@contracts/agent/DefectFindings";
import { copy } from "./copy";

const exec = promisify(execFile);

const SIZE = { width: 1512, height: 950 };

const file = (path: string, blob: string): ChangedFile => ({ path, status: "modified", line: 1, counts: { added: 3, removed: 2 }, blob });

const text = (revision: string, body: string) => ({ kind: "text", revision, text: body }) as const;

// Lines 6 and 22 change in the file.
const line = (n: number, tag: string) => "  const value" + n + " = " + n + tag + ";";

const body = (tag: string) => Array.from({ length: 30 }, (_, n) => line(n, n === 5 || n === 21 ? tag : "")).join("\n") + "\n";

const COMPARISON: FileComparison = { base: "base", oldPath: "", newPath: "", status: "modified", old: text("o", body("")), new: text("n", body(" + 1")) };

const PATH = "crates/module-01/src/lib.rs";

const FOUND: DefectFindings = {
  state: "found",
  findings: [
    { path: PATH, start: 6, end: 6, source: line(5, " + 1"), text: "The cache lookup ignores a missing entry and returns a stale value.", label: "issue" },
    { path: PATH, start: 22, end: 22, source: line(21, " + 1"), text: "This repeats the offset the line above already adds.", label: "nit" },
  ],
};

const FAILED: DefectFindings = { state: "failed", kind: "badAnswer", cause: "the answer is not findings: expected an object with a findings list" };

const present = (expression: string) => "!!document.querySelector(" + JSON.stringify(expression) + ")";

// U7700g: `just capture U7700g` writes each state at 1512 by 950, dark, over the U26 harness; the design critic judges layout and looks.
it("u7700g_the_findings_are_captured_for_the_critic", async () => {
  const directory = captureDir("U7700g");

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

  /** The Daemon lists the file and answers `agent.findDefects` with `answer`. */
  const serve = (answer: DefectFindings) => {
    const files = [file(PATH, "one")];
    const groups = [{ repo: "/p/transform-education", checkout: "/p/transform-education", branch: "main", base: "main", files }];

    return read(`(() => {
      const handlers = window.__fake.app.handlers;

      handlers["agent.ownedChanges"] = () => ({ groups: ${JSON.stringify(groups)} });
      handlers["agent.changedFiles"] = () => ({ files: ${JSON.stringify(files)} });
      handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path });
      handlers["agent.findDefects"] = () => (${JSON.stringify(answer)});
      window.__fake.setStatus("agent-1", "idle", "ready");

      return window.__worktrees.refresh("agent-1").then(() => true);
    })()`);
  };

  const shot = async (name: string, ready: string) => {
    await until(ready);
    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, name + ".png"));

    const checks = await read<Checks>("window.__checks()");

    writeFileSync(join(directory, name + ".checks.json"), JSON.stringify(checks, null, 2));
    shots.push({ name, checks });
  };

  const choose = (target: string) => read(`document.querySelector('.changes-view .app-segment[aria-label="${target}"]')?.click() ?? false`);

  const press = (name: string) => read(`document.querySelector('button[aria-label="${name}"]')?.click() ?? false`);

  /** The Changes view over the Tree target, the pass asked on its Overview. */
  const asked = async (answer: DefectFindings) => {
    await serve(answer);
    await until("!!document.querySelector('.changes-icon')");
    await browser("click", ".changes-icon");
    await until("!!document.querySelector('.changes-view .changes-side [data-row=\"module\"]')");
    await choose("Tree");
    await until(present('.findings button[aria-label="' + copy.findDefects + '"]'));
    await press(copy.findDefects);
  };

  /** The first module open, its diff drawn with the findings under their lines. */
  const drawn = async () => {
    await until(present(".changes-side [data-row=\"module\"]"));
    await browser("click", '.changes-side [data-row="module"]');
    await until("document.querySelectorAll('.finding').length > 0");
  };

  const states: { name: string; answer: DefectFindings; run: () => Promise<void> }[] = [
    { name: "pending", answer: FOUND, run: async () => { await drawn(); await shot("pending", "document.querySelectorAll('.finding').length === 2"); } },
    { name: "kept", answer: FOUND, run: async () => { await drawn(); await press(copy.keepFinding); await shot("kept", "document.querySelectorAll('.finding').length === 1"); } },
    { name: "dropped", answer: FOUND, run: async () => { await drawn(); await press(copy.dropFinding); await shot("dropped", "document.querySelectorAll('.finding').length === 1"); } },
    { name: "failed", answer: FAILED, run: async () => { await shot("failed", present(".findings .flow-cause")); } },
  ];

  try {
    // Each state is a session of its own: a page that opened the view many times stops answering (#7924).
    for (const state of states) {
      session = "changes-findings-" + process.pid + "-" + state.name;
      await browser("open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
      await browser("set", "media", "dark");
      await browser("set", "viewport", String(SIZE.width), String(SIZE.height));
      await until("!!window.__fake && !!document.querySelector('.changes-icon')");
      await asked(state.answer);
      await state.run();
      await browser("close");
    }
  } finally {
    await server.close();
  }

  // D2, D3, D5, D6 and D10 hold on every state (U7700g); every capture is written before one fails the run.
  expect(shots.flatMap(each => [each.checks.D2, each.checks.D3, each.checks.D5, each.checks.D6, each.checks.D10].some(check => check.status !== "pass") ? [each.name] : [])).toEqual([]);
}, 900_000);
