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
import { copy } from "./copy";

const exec = promisify(execFile);

const SIZE = { width: 1512, height: 950 };

const file = (path: string): ChangedFile => ({ path, status: "modified", line: 1, counts: { added: 3, removed: 2 }, blob: null });

const text = (revision: string, body: string) => ({ kind: "text", revision, text: body }) as const;

const body = (tag: string) => Array.from({ length: 30 }, (_, n) => "  const value" + n + " = " + n + (n === 5 || n === 21 ? tag : "") + ";").join("\n") + "\n";

const COMPARISON: FileComparison = { base: "base", oldPath: "", newPath: "", status: "modified", old: text("o", body("")), new: text("n", body(" + 1")) };

const PATH = "crates/module-01/src/lib.rs";

const FILES = [file(PATH)];

const READ: Readback = {
  state: "read",
  overview: "Adds a loader and wires every module through it.",
  diagram: "Before\nrun -> load\nAfter\nrun -> cache -> load",
  flows: [],
  modules: [{ module: "crates/module-01", account: "Loads data through a cache." }],
  unplaced: [],
  ranks: [],
  risks: [],
  explanations: [],
  gaps: [],
};

const said = (words: string) => "document.querySelector('.changes-view')?.textContent.includes(" + JSON.stringify(words) + ")";

// U7702g: `just capture U7702g` writes each state at 1512 by 950, dark, over the U26 harness; the design critic judges layout and looks.
it("u7702g_the_save_is_captured_for_the_critic", async () => {
  const directory = captureDir("U7702g");

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

  /** The Daemon answers with the listing of the Tree target, each file's comparison and the read readback; `pad.create` answers with `creating`. */
  const serve = (creating: string) => {
    const groups = [{ repo: "/p/transform-education", branch: "main", base: "main", files: FILES }];

    return read(`(() => {
      const handlers = window.__fake.app.handlers;

      handlers["agent.ownedChanges"] = () => ({ groups: ${JSON.stringify(groups)} });
      handlers["agent.changedFiles"] = () => ({ files: ${JSON.stringify(FILES)} });
      handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path });
      handlers["agent.readback"] = () => (${JSON.stringify(READ)});
      handlers["agent.readbackStart"] = () => ({ state: "reading" });
      ${creating}
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

  const button = "button[aria-label=" + JSON.stringify(copy.savePad) + "]";

  const present = "!!document.querySelector('" + button + "')";

  /** The Changes view over the Tree target, the readback read. */
  const opened = async (creating: string) => {
    await serve(creating);
    await until("!!document.querySelector('.changes-icon')");
    await browser("click", ".changes-icon");
    await until("!!document.querySelector('.changes-view .changes-side [data-row=\"overview\"]')");
    await read("document.querySelector('.changes-view .app-segment[aria-label=\"Tree\"]')?.click() ?? false");
    await until(present);
  };

  const REFUSE = 'handlers["pad.create"] = () => { throw new Error("invalid pad name"); };';

  const states: { name: string; creating: string; run: () => Promise<void> }[] = [
    { name: "ready", creating: "", run: () => shot("ready", present) },
    { name: "saved", creating: "", run: async () => { await read("document.querySelector('" + button + "')?.click() ?? false"); await shot("saved", said(copy.padSaved(""))); } },
    { name: "failed", creating: REFUSE, run: async () => { await read("document.querySelector('" + button + "')?.click() ?? false"); await shot("failed", said(copy.padNotSaved)); } },
  ];

  try {
    // Each state is a session of its own: a page that opened the view many times stops answering (#7924).
    for (const state of states) {
      session = "changes-pad-" + process.pid + "-" + state.name;
      await browser("open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
      await browser("set", "media", "dark");
      await browser("set", "viewport", String(SIZE.width), String(SIZE.height));
      await until("!!window.__fake && !!document.querySelector('.changes-icon')");
      await opened(state.creating);
      await state.run();
      await browser("close");
    }
  } finally {
    await server.close();
  }

  expect(shots.flatMap(each => [each.checks.D2, each.checks.D5, each.checks.D6].some(check => check.status !== "pass") ? [each.name] : [])).toEqual([]);
}, 900_000);
