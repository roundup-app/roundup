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
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { copy } from "./copy";

const exec = promisify(execFile);

const SIZE = { wide: 1512, centre: 388, height: 950 };

const AGENT = "/p/.roundup/agent-1";

const file = (path: string, over: Partial<ChangedFile> = {}): ChangedFile => ({ path, status: "modified", line: 1, counts: { added: 1, removed: 1 }, blob: null, ...over });

const text = (revision: string, body: string) => ({ kind: "text", revision, text: body }) as const;

const comparison = (over: Partial<FileComparison> = {}): FileComparison => ({ base: "base", oldPath: "src/a.ts", newPath: "src/a.ts", status: "modified", old: text("o", "const first = 1;\nconst second = 2;\n"), new: text("n", "const first = 3;\nconst second = 4;\n"), ...over });

const TWO = [file("src/a.ts"), file("src/b.ts")];

const MANY = Array.from({ length: 500 }, (_, n) => file("folder/" + "p".repeat(100) + n + ".ts"));

/** What the page's fake Daemon answers: the files the Agent owns, each file's comparison (`"never"` never answers) and, for the Tree and Branch switch values, the listing expression. */
type Served = { files: ChangedFile[]; answers?: Record<string, FileComparison | "never">; listing?: string };

const READY = "!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')";

const said = (words: string) => `document.querySelector('.changes-view')?.textContent.includes(${JSON.stringify(words)})`;

// U7675g: `just capture U7675g` writes each state at 1512 by 950 and at the centre's 388 px minimum, dark, over the U26 harness; the design critic judges layout and looks.
it("u7675g_the_states_are_captured_for_the_critic", async () => {
  const directory = captureDir("U7675g");

  if (!directory) return;

  const server = await appServer();
  const session = `changes-states-${process.pid}`;
  const profile = mkdtempSync(join(tmpdir(), "changes-states-"));
  const browser = async (...args: string[]) => (await exec(agentBrowserExecutable, ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })).stdout;

  const read = async <T,>(expression: string): Promise<T> => {
    // SAFETY: agent-browser wraps these constant DOM expressions in its JSON envelope.
    const result = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };

  const until = (expression: string) => browser("wait", "--fn", expression);

  const click = (name: string) => browser("find", "role", "button", "click", "--name", name, "--exact");

  const serve = (served: Served) => read(`(() => {
    const files = ${JSON.stringify(served.files)};
    const answers = ${JSON.stringify(served.answers ?? { "*": comparison() })};
    const handlers = window.__fake.app.handlers;

    handlers["agent.changedFiles"] = ${served.listing ?? "() => ({ files })"};
    handlers["agent.compareFile"] = ({ path }) => answers[path] === "never" ? new Promise(() => {}) : answers[path] ?? answers["*"];

    return true;
  })()`);

  /** The Agent owns `files` now: the Rail reads what it owns again, as it does when the Agent goes idle. */
  const owns = (files: ChangedFile[]) => read(`(() => {
    const files = ${JSON.stringify(files)};

    window.__fake.app.handlers["agent.ownedChanges"] = () => ({ groups: files.length === 0 ? [] : [{ repo: ${JSON.stringify(AGENT)}, branch: "roundup/agent-1", base: "main", files }] });
    window.__fake.setStatus("agent-1", "idle", "ready");

    return window.__worktrees.refresh("agent-1").then(() => true);
  })()`);

  const showTree = () => read(`(() => { document.querySelector('.changes-head [aria-label=${JSON.stringify(copy.targetTree)}]').click(); return true; })()`);

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

  /** A fresh page over `served`, the Agent named `name`, the Changes view open on its first read. */
  const opened = async (served: Served, name?: string) => {
    await browser("open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
    await until("!!window.__fake && !!document.querySelector('.changes-icon')");
    await serve(served);

    if (name) {
      await read(`window.__fake.app.rpc("rail.rename", { id: "agent-1", name: ${JSON.stringify(name)} }).then(() => true)`);
      await until(`document.querySelector('.rail-row[data-id="agent-1"]')?.textContent.includes(${JSON.stringify(name)})`);
    }

    await owns(served.files);
    await until(`document.querySelector('.rail-row[data-id="agent-1"] .changes-icon .changes-count')?.textContent === '${served.files.length}'`);
    await browser("click", ".changes-icon");
    await until("!!document.querySelector('.changes-view .changes-side')");
  };

  const forever = "() => new Promise(() => {})";

  const states: { run: () => Promise<void> }[] = [
    { run: async () => { await opened({ files: TWO, listing: forever }); await showTree(); await shot("comparing", said(copy.comparing)); } },
    { run: async () => { await opened({ files: TWO }); await shot("loaded", READY); } },
    { run: async () => { await opened({ files: TWO }); await until(READY); await owns([]); await shot("no-changes", said(copy.noChangesAgainst(copy.remoteMain))); } },
    { run: async () => { await opened({ files: TWO, listing: "() => ({ files: [] })" }); await showTree(); await shot("folder-matches", said("folder matches")); } },
    { run: async () => { await opened({ files: TWO, listing: "() => { throw new Error('fatal: bad revision origin/main...HEAD: unknown revision or path not in the working tree'); }" }); await showTree(); await shot("failed", said("Couldn't compare")); } },
    { run: async () => {
      await opened({ files: TWO, listing: `() => { throw new Error("worktree_missing: ${AGENT}"); }` });
      await showTree();
      await shot("folder-gone", said("no longer exists"));
      await click(copy.retry);
      await shot("folder-gone-checked", said(copy.stillMissing));
    } },
    { run: async () => { await opened({ files: TWO, answers: { "*": comparison(), "src/b.ts": "never" } }); await until(READY); await browser("press", "j"); await shot("file-loading", said(copy.loadingFile("src/b.ts"))); } },
    { run: async () => { await opened({ files: [file("src/a.ts", { status: "added" })], answers: { "*": comparison({ status: "added", old: { kind: "absent", revision: "absent" } }) } }); await shot("added", READY); } },
    { run: async () => { await opened({ files: [file("src/a.ts", { status: "deleted" })], answers: { "*": comparison({ status: "deleted", new: { kind: "absent", revision: "absent" } }) } }); await shot("deleted", READY); } },
    { run: async () => { await opened({ files: [file("src/a.ts", { status: "renamed" })], answers: { "*": comparison({ status: "renamed", oldPath: "old/a.ts" }) } }); await shot("renamed", `${READY} && ${said(copy.renamedPaths("old/a.ts", "src/a.ts"))}`); } },
    { run: async () => { await opened({ files: TWO, answers: { "*": comparison({ old: { kind: "binary", revision: "o" }, new: { kind: "binary", revision: "n" } }) } }); await shot("binary", said(copy.binaryDiff)); } },
    { run: async () => { await opened({ files: TWO, answers: { "*": comparison({ old: text("o", "same\n"), new: text("n", "same\n") }) } }); await shot("mode-only", said(copy.modeOnly)); } },
    { run: async () => { await opened({ files: TWO, answers: { "*": comparison({ old: text("o", "a b\n"), new: text("n", "a  b\n") }) } }); await shot("whitespace-only", said(copy.noDifference)); } },
    { run: async () => { const side = (mark: string) => (mark + "\n").repeat(20001); await opened({ files: TWO, answers: { "*": comparison({ old: text("o", side("x")), new: text("n", side("y")) }) } }); await shot("too-large", said(copy.tooLarge)); } },
    { run: async () => { await opened({ files: [file("src/a.ts", { blob: "one" })] }); await until(READY); await owns([file("src/a.ts", { blob: "two" })]); await shot("updated-on-disk", said(" updated this file")); } },
    { run: async () => { await opened({ files: TWO }); await until(READY); await owns([file("src/b.ts")]); await shot("left-the-list", said("no longer differs from")); } },
    { run: async () => { await opened({ files: TWO }); await until(READY); await browser("press", "?"); await shot("keys", "!!document.querySelector('.changes-keys')"); } },
    { run: async () => { const path = "folder/" + "p".repeat(113) + ".ts"; await opened({ files: [file(path)], answers: { "*": comparison({ oldPath: path, newPath: path }) } }); await shot("path-120", READY); } },
    { run: async () => { await opened({ files: TWO }, "x"); await shot("name-one-letter", READY); } },
    { run: async () => { await opened({ files: TWO }, "🦊"); await shot("name-emoji", READY); } },
    { run: async () => { await opened({ files: MANY }); await shot("files-500", READY); } },
    { run: async () => {
      await opened({ files: MANY });
      await until(READY);
      await read("(() => { document.querySelector('.module-scroll').scrollTop = 2400; return true; })()");
      await shot("tree-scrolled", READY);
      // U7675c: a file leaves the list; the tree's scroll and focus stay for the critic to compare with the shot before.
      await owns(MANY.slice(1));
      await shot("tree-list-changed", said(copy.changedFiles(499)));
    } },
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

  // D2, D5 and D6 hold on every state (U7675g); every capture is written before one fails the run.
  expect(shots.flatMap(each => [each.checks.D2, each.checks.D5, each.checks.D6].some(check => check.status !== "pass") ? [each.name] : [])).toEqual([]);
}, 540_000);
