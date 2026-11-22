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

const file = (path: string, over: Partial<ChangedFile> = {}): ChangedFile => ({ path, status: "modified", line: 1, counts: { added: 3, removed: 2 }, blob: null, ...over });

const text = (revision: string, body: string) => ({ kind: "text", revision, text: body }) as const;

/** Sixty lines with a function every twenty and a change at lines 5 and 45, so the diff holds two hunks that each name their function. */
const body = (tag: string) => Array.from({ length: 60 }, (_, n) => n % 20 === 0 ? "function part" + n + "() {" : "  const value" + n + " = " + n + (n === 5 || n === 45 ? tag : "") + ";").join("\n") + "\n";

const COMPARISON: FileComparison = { base: "base", oldPath: "", newPath: "", status: "modified", old: text("o", body("")), new: text("n", body(" + 1")) };

const BINARY: Partial<FileComparison> = { old: { kind: "binary", revision: "o" }, new: { kind: "binary", revision: "n" } };

const NAMES = Array.from({ length: 14 }, (_, n) => `pkg-${String(n).padStart(2, "0")}`);

// Fourteen modules, one with no counts, and a row for each kind of noise.
const FOURTEEN = [...NAMES.flatMap((name, n) => [file(`${name}/src/a.ts`, n === 13 ? { counts: null } : {}), file(`${name}/src/b.test.ts`)]), file("yarn.lock", { counts: null }), file("api/generated/g.ts")];

// The dense fixture: 500 files under one folder, each path 120 characters.
const DENSE = Array.from({ length: 500 }, (_, n) => file(`folder/${"p".repeat(107)}${String(n).padStart(3, "0")}.ts`));

/** What the page's fake Daemon answers: the files the Agent owns, and each file's comparison: COMPARISON at the file's path, less what `special` overrides for it. */
type Served = { files: ChangedFile[]; special?: Record<string, Partial<FileComparison>> };

const READY = "!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')";

const said = (words: string) => `document.querySelector('.changes-view')?.textContent.includes(${JSON.stringify(words)})`;

const FOCUS_DIFF = "(() => { document.querySelector('.diff-content').focus(); return true; })()";

const LIST_END = "(() => { document.querySelector('.changes-tree').scrollTop = 1e6; return true; })()";

const NOISE = "document.querySelectorAll('.changes-side [data-row=\"noise\"]')";

// U7678e: `just capture U7678e` writes each state at 1512 by 950 and at the centre's 388 px minimum, dark, over the U26 harness; the design critic judges layout and looks.
it("u7678e_the_modules_are_captured_for_the_critic", async () => {
  const directory = captureDir("U7678e");

  if (!directory) return;

  const server = await appServer();
  const session = `changes-modules-${process.pid}`;
  const profile = mkdtempSync(join(tmpdir(), "changes-modules-"));
  const browser = async (...args: string[]) => (await exec(agentBrowserExecutable, ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })).stdout;

  const read = async <T,>(expression: string): Promise<T> => {
    // SAFETY: agent-browser wraps these constant DOM expressions in its JSON envelope.
    const result = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };

  const until = (expression: string) => browser("wait", "--fn", expression);

  const serve = (served: Served) => read(`(() => {
    const files = ${JSON.stringify(served.files)};
    const special = ${JSON.stringify(served.special ?? {})};
    const handlers = window.__fake.app.handlers;

    handlers["agent.changedFiles"] = () => ({ files });
    handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path, ...special[path] });

    return true;
  })()`);

  /** The Agent owns `files` now: the Rail reads what it owns again, as it does when the Agent goes idle. */
  const owns = (files: ChangedFile[]) => read(`(() => {
    const files = ${JSON.stringify(files)};

    window.__fake.app.handlers["agent.ownedChanges"] = () => ({ groups: files.length === 0 ? [] : [{ repo: ${JSON.stringify(AGENT)}, branch: "roundup/agent-1", base: "main", files }] });
    window.__fake.setStatus("agent-1", "idle", "ready");

    return window.__worktrees.refresh("agent-1").then(() => true);
  })()`);

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

  /** A fresh page over `served`, the Changes view open on its first module. */
  const opened = async (served: Served) => {
    await browser("open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
    await until("!!window.__fake && !!document.querySelector('.changes-icon')");
    await serve(served);
    await owns(served.files);
    await until(`document.querySelector('.rail-row[data-id="agent-1"] .changes-icon .changes-count')?.textContent === '${served.files.length}'`);
    await browser("click", ".changes-icon");
    await until("!!document.querySelector('.changes-view .changes-side')");
  };

  const states: { name: string; run: () => Promise<void> }[] = [
    { name: "dense", run: async () => { await opened({ files: DENSE }); await shot("dense", READY); } },
    { name: "modules", run: async () => { await opened({ files: FOURTEEN }); await shot("modules", READY); } },
    { name: "scroll-hunk-headers", run: async () => { await opened({ files: FOURTEEN }); await until(READY); await read("(() => { document.querySelector('.module-scroll').scrollTop = 300; return true; })()"); await shot("scroll-hunk-headers", READY); } },
    { name: "file-notice", run: async () => { await opened({ files: [file("m/a.ts"), file("m/z.bin")], special: { "m/z.bin": BINARY } }); await shot("file-notice", said(copy.binaryDiff)); } },
    { name: "noise-folded", run: async () => { await opened({ files: FOURTEEN }); await until(READY); await read(LIST_END); await shot("noise-folded", `${NOISE}.length === 2`); } },
    { name: "noise-unfolded", run: async () => {
      await opened({ files: FOURTEEN });
      await until(READY);
      await read(`(() => { ${NOISE}[1].focus(); return true; })()`);
      await browser("press", "ArrowRight");
      await read(LIST_END);
      await shot("noise-unfolded", "!!document.querySelector('.changes-side [data-row=\"file\"][data-path=\"yarn.lock\"]')");
    } },
    { name: "unfinished-work", run: async () => {
      await opened({ files: FOURTEEN });
      await until(READY);
      await read(FOCUS_DIFF);
      await browser("press", "n");
      await until("!!document.querySelector('.note-form')");
      await browser("find", "label", "Note", "fill", "Rename this once the callers agree");
      await browser("press", "Escape");
      await shot("unfinished-work", `[...document.querySelectorAll('.changes-side [data-row="module"]')].some(row => row.getAttribute('aria-label')?.includes(${JSON.stringify(copy.unfinishedWork)}))`);
    } },
    { name: "name-120", run: async () => { await opened({ files: [file(`${"m".repeat(120)}/a.ts`)] }); await shot("name-120", READY); } },
    { name: "name-one-letter", run: async () => { await opened({ files: [file("x/a.ts")] }); await shot("name-one-letter", READY); } },
    { name: "name-emoji", run: async () => { await opened({ files: [file("🦊/a.ts")] }); await shot("name-emoji", READY); } },
    { name: "files-100", run: async () => { await opened({ files: Array.from({ length: 100 }, (_, n) => file(`big/f${n}.ts`)) }); await shot("files-100", READY); } },
    { name: "files-0", run: async () => { await opened({ files: [file("m/a.ts")] }); await until(READY); await owns([]); await shot("files-0", said(copy.noChangesAgainst(copy.remoteMain))); } },
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

  // D2, D5 and D6 hold on every state (U7678e); every capture is written before one fails the run.
  expect(shots.flatMap(each => [each.checks.D2, each.checks.D5, each.checks.D6].some(check => check.status !== "pass") ? [each.name] : [])).toEqual([]);
}, 540_000);
