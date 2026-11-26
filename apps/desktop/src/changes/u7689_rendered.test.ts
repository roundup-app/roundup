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
import type { Account } from "@contracts/agent/Account";
import type { Readback } from "@contracts/agent/Readback";

const exec = promisify(execFile);

const SIZE = { wide: 1512, height: 950 };

const file = (path: string): ChangedFile => ({ path, status: "modified", line: 1, counts: { added: 3, removed: 2 }, blob: null });

const text = (revision: string, body: string) => ({ kind: "text", revision, text: body }) as const;

// Lines 6 and 22 change in every file: the first sits in the first function of a file, the second in the second.
const body = (tag: string) => Array.from({ length: 30 }, (_, n) => "  const value" + n + " = " + n + (n === 5 || n === 21 ? tag : "") + ";").join("\n") + "\n";

const COMPARISON: FileComparison = { base: "base", oldPath: "", newPath: "", status: "modified", old: text("o", body("")), new: text("n", body(" + 1")) };

// The 14-module fixture of U7679f, and the files the flows below name.
const FOURTEEN = Array.from({ length: 14 }, (_, n) => file("crates/module-" + String(n + 1).padStart(2, "0") + "/src/lib.rs"));

const FLOW_FILES = ["apps/a/src/run.ts", "apps/a/src/load.ts", "apps/a/src/types.ts", "docs/README.md", "pnpm-lock.yaml"].map(file);

const symbol = (path: string, name: string, start: number, end: number) => ({ key: path + "##" + name + "#function", name, kind: "function", path, old: { start, end }, new: { start, end }, status: "changed", callable: true });

const RUN = symbol("apps/a/src/run.ts", "run", 1, 10);

const LOAD = symbol("apps/a/src/load.ts", "load", 1, 10);

const call = (of: { key: string; name: string; kind: string; path: string }) => ({ key: of.key, name: of.name, kind: of.kind, path: of.path, status: "changed" });

const node = (of: { key: string }, calls: unknown[] = []) => ({ key: of.key, status: "changed", cycle: false, calls });

const TYPESCRIPT = {
  state: "done",
  symbols: [RUN, LOAD],
  calls: [
    { key: RUN.key, outgoing: [call(LOAD)], incoming: [], incoming_unchanged: 0 },
    { key: LOAD.key, outgoing: [], incoming: [call(RUN)], incoming_unchanged: 1 },
  ],
  flows: [{ entry: RUN.key, tree: node(RUN, [node(LOAD)]), capped: false }],
  capped: false,
  oldSideResolvedThroughNewDependencies: false,
};

const LOOKUP = { languages: [{ language: "typescript", files: 2, server: { found: true, name: "typescript-server" } }, { language: "rust", files: 14, server: { found: false, cause: { kind: "notInstalled", detail: "none" } } }] };

const step = (note: string, ...hunks: string[]) => ({ note, hunks });

const ACCOUNT: Account = {
  overview: "Adds a loader and a checked shout.",
  diagram: "",
  flows: [
    { id: "code-1", name: "Run loads the data", source: "code", steps: [step("Load reads the data.", "apps/a/src/load.ts#1"), step("Run asks load for it.", "apps/a/src/run.ts#1")] },
    { id: "added-1", name: "Shout is checked", source: "readback", steps: [step("Shout upcases its input.", "crates/module-01/src/lib.rs#1")] },
  ],
  modules: [],
  unplaced: ["apps/a/src/types.ts#1"],
  gaps: [],
};

const READ: Readback = { state: "read", ...ACCOUNT };

const READY = "!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')";

const said = (words: string) => "document.querySelector('.changes-view')?.textContent.includes(" + JSON.stringify(words) + ")";

// U7689g: `just capture U7689g` writes each state at 1512 by 950, dark, over the U26 harness; the design critic judges layout and looks.
it("u7689g_the_flows_lens_after_a_readback_is_captured_for_the_critic", async () => {
  const directory = captureDir("U7689g");

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

  /** The Daemon answers with the listing of the Tree target, each file's comparison, the TypeScript trace and the readback. */
  const serve = (answer: Readback) => {
    const files = [...FOURTEEN, ...FLOW_FILES];
    const groups = [{ repo: "/p/transform-education", branch: "main", base: "main", files }];

    return read(`(() => {
      const handlers = window.__fake.app.handlers;

      handlers["agent.ownedChanges"] = () => ({ groups: ${JSON.stringify(groups)} });
      handlers["agent.changedFiles"] = () => ({ files: ${JSON.stringify(files)} });
      handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path });
      handlers["agent.callPaths"] = ({ language }) => language === undefined ? ${JSON.stringify(LOOKUP)} : language === "typescript" ? ${JSON.stringify(TYPESCRIPT)} : { state: "noServer" };
      handlers["agent.readback"] = () => (${JSON.stringify(answer)});
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

  /** The Changes view over the Tree target, opened in the Flows lens: the Daemon answers first, then the icon opens the view. */
  const opened = async (answer: Readback) => {
    await serve(answer);
    await until("!!document.querySelector('.changes-icon')");
    await browser("click", ".changes-icon");
    await until("!!document.querySelector('.changes-view .changes-side [data-row=\"overview\"]')");
    await browser("click", ".changes-view .app-segment[aria-label=\"Tree\"]");
    await browser("click", ".changes-side .app-segment[aria-label=\"Flows\"]");
    await until("!!document.querySelector('.changes-side .app-segment[aria-label=\"Flows\"][data-checked]')");
  };

  const states: { name: string; answer: Readback; run: () => Promise<void> }[] = [
    { name: "read", answer: READ, run: async () => { await browser("click", '.changes-side [data-row="module"]'); await shot("read", READY + " && !!document.querySelector('.flow-account') && " + said("Shout is checked")); } },
    { name: "stale", answer: { ...ACCOUNT, state: "stale" }, run: async () => { await browser("click", '.changes-side [data-row="module"]'); await shot("stale", READY + " && !!document.querySelector('.changes-row-name[data-stale=\"true\"]')"); } },
  ];

  try {
    // Each state is a session of its own: a page that opened the view many times stops answering.
    for (const state of states) {
      session = "changes-readback-flows-" + process.pid + "-" + state.name;
      await browser("open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
      await browser("set", "media", "dark");
      await browser("set", "viewport", String(SIZE.wide), String(SIZE.height));
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
