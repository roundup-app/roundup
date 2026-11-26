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

const SIZE = { wide: 1512, centre: 388, height: 950 };

const file = (path: string): ChangedFile => ({ path, status: "modified", line: 1, counts: { added: 3, removed: 2 }, blob: null });

const text = (revision: string, body: string) => ({ kind: "text", revision, text: body }) as const;

const body = (tag: string) => Array.from({ length: 30 }, (_, n) => "  const value" + n + " = " + n + (n === 5 ? tag : "") + ";").join("\n") + "\n";

const COMPARISON: FileComparison = { base: "base", oldPath: "", newPath: "", status: "modified", old: text("o", body("")), new: text("n", body(" + 1")) };

const many = (count: number, make: (n: number) => string) => Array.from({ length: count }, (_, n) => file(make(n)));

// Fourteen modules, each with logic and every second one with a test, so every lens lists modules.
const FOURTEEN = many(14, n => `crates/module-${String(n + 1).padStart(2, "0")}/src/lib.rs`).concat(many(7, n => `crates/module-${String(n * 2 + 1).padStart(2, "0")}/tests/it.rs`));

// A change with no test: the Tests lens lists no module.
const NO_TESTS = [file("crates/a/src/x.rs"), file("README.md")];

// The dense fixture: 499 files in 25 modules and the 120-character path.
const DENSE = [...many(499, n => `crates/dense-${String(n % 25).padStart(2, "0")}/src/file-${n}.ts`), file(`${"directory/".repeat(10)}very-long-file-name.ts`)];

// The worst cases: a module of 100 files, a 120-character module name, a one-letter name, an emoji name, and the noise rows.
const WORST = [...many(100, n => `crates/aa-big/src/f-${n}.rs`), file(`${"m".repeat(120)}/src/a.rs`), file("x/src/a.rs"), file("crates/🦀-lenses/src/a.rs"), file("README.md"), file("pnpm-lock.yaml"), file("crates/gen/generated/g.rs")];

type Group = { repo: string; checkout: string; branch: string; base: string; files: ChangedFile[] };

const READY = "!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')";

const said = (words: string) => `document.querySelector('.changes-view')?.textContent.includes(${JSON.stringify(words)})`;

const FOCUS_DIFF = "(() => { document.querySelector('.diff-content').focus(); return true; })()";

const LENS = (lens: string, checked = "") => `!!document.querySelector('.changes-side .app-segment[aria-label="${lens}"]${checked}')`;

// U7679f: `just capture U7679f` writes each state at 1512 by 950 and at the centre's 388 px minimum, dark, over the U26 harness; the design critic judges layout and looks.
it("u7679f_the_lenses_overview_and_find_are_captured_for_the_critic", async () => {
  const directory = captureDir("U7679f");

  if (!directory) return;

  const server = await appServer();
  const shots: { name: string; checks: Checks }[] = [];
  let session = "";
  let lane = "";

  const browser = async (...args: string[]) => (await exec(agentBrowserExecutable, ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })).stdout;

  const read = async <T,>(expression: string): Promise<T> => {
    // SAFETY: agent-browser wraps these constant DOM expressions in its JSON envelope.
    const result = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };

  const until = (expression: string) => browser("wait", "--fn", expression);

  /** The Daemon answers with `groups` and each file's comparison. */
  const serve = (files: ChangedFile[]) => {
    const groups: Group[] = [{ repo: "/p/transform-education", checkout: "/p/transform-education", branch: "main", base: "main", files }];

    return read(`(() => {
      const handlers = window.__fake.app.handlers;

      handlers["agent.ownedChanges"] = () => ({ groups: ${JSON.stringify(groups)} });
      handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path });
      window.__fake.setStatus("agent-1", "idle", "ready");

      return window.__worktrees.refresh("agent-1").then(() => true);
    })()`);
  };

  const shot = async (state: string, ready: string) => {
    const name = `${lane}-${state}`;

    await until(ready);
    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, `${name}.png`));

    const checks = await read<Checks>("window.__checks()");

    writeFileSync(join(directory, `${name}.checks.json`), JSON.stringify(checks, null, 2));
    shots.push({ name, checks });
  };

  /** The Changes view over `files`, closed and opened again so each state reads afresh; it opens on the Overview of the lens last used (U7679c). */
  const opened = async (files: ChangedFile[]) => {
    await read("(() => { document.querySelector('.changes-view [data-button=\"quiet\"]:last-of-type')?.click(); return true; })()");
    await serve(files);
    await until("!!document.querySelector('.changes-icon')");
    await browser("click", ".changes-icon");
    await until("!!document.querySelector('.changes-view .changes-side [data-row=\"overview\"]')");
  };

  const lens = async (name: string) => {
    await browser("click", `.changes-side .app-segment[aria-label="${name}"]`);
    await until(LENS(name, "[data-checked]"));
  };

  const entries = "!!document.querySelector('.changes-overview [data-entry]')";

  const unfold = async () => {
    await read("(() => { document.querySelector('.changes-side [data-row=\"module\"]').focus(); return true; })()");
    await browser("press", "ArrowRight");
  };

  const find = async (letters: string) => {
    await browser("press", "/");
    await until("!!document.querySelector('.changes-find input')");
    await browser("fill", ".changes-find input", letters);
  };

  const states: { name: string; run: () => Promise<void> }[] = [
    { name: "modules", run: async () => { await opened(FOURTEEN); await lens("Modules"); await shot("modules", entries); } },
    { name: "logic", run: async () => { await opened(FOURTEEN); await lens("Logic"); await shot("logic", entries); } },
    { name: "tests", run: async () => { await opened(FOURTEEN); await lens("Tests"); await shot("tests", entries); } },
    { name: "tests-open", run: async () => { await opened(FOURTEEN); await lens("Tests"); await browser("click", '.changes-side [data-row="module"]'); await shot("tests-open", READY); } },
    { name: "no-module", run: async () => { await opened(NO_TESTS); await lens("Tests"); await shot("no-module", said("No changes in Tests")); } },
    { name: "dense", run: async () => { await opened(DENSE); await lens("Modules"); await shot("dense", entries); } },
    { name: "dense-find", run: async () => { await opened(DENSE); await lens("Modules"); await find("file-1"); await shot("dense-find", "!!document.querySelector('.changes-side [data-row=\"file\"]')"); } },
    { name: "dense-no-match", run: async () => { await opened(DENSE); await lens("Modules"); await find("zzzz"); await shot("dense-no-match", said("No file matches zzzz in Modules")); } },
    { name: "worst", run: async () => { await opened(WORST); await lens("Modules"); await shot("worst", entries); } },
    { name: "worst-unfolded", run: async () => { await opened(WORST); await lens("Modules"); await unfold(); await shot("worst-unfolded", "!!document.querySelector('.changes-side [data-row=\"file\"]')"); } },
    { name: "empty", run: async () => { await opened(NO_TESTS); await serve([]); await shot("empty", said("No changes against remote main")); } },
    // Last: the unfinished note stays in the connection's drafts, so every later state would show its mark.
    { name: "marked", run: async () => { await opened(FOURTEEN); await lens("Modules"); await browser("click", '.changes-side [data-row="module"]'); await until(READY); await read(FOCUS_DIFF); await browser("press", "n"); await until("!!document.querySelector('.note-form')"); await browser("find", "label", "Note", "fill", "Rename this once the callers agree."); await shot("marked", "!!document.querySelector('.changes-side [aria-label*=\"Unfinished work\"]')"); } },
  ];

  // Each lane is a session of its own: after `set viewport` this Chrome loads no further page in the session.
  const lanes = [{ name: "dark-wide", wide: true }, { name: "dark-centre", wide: false }];

  try {
    for (const each of lanes) {
      lane = each.name;
      session = `changes-lenses-${process.pid}-${lane}`;
      await browser("open", new URL("/src/changes/u2540.html?shared", server.resolvedUrls.local[0] ?? "").href);
      await browser("set", "media", "dark");
      await browser("set", "viewport", String(SIZE.wide), String(SIZE.height));
      await until("!!window.__fake && !!document.querySelector('.changes-icon')");
      await browser("click", ".changes-icon");
      await until("!!document.querySelector('.changes-view .changes-side')");

      // The width that leaves the view the centre's minimum: the wide window less what the view has over it.
      const view = await read<number>("document.querySelector('.changes-view').getBoundingClientRect().width");

      if (!each.wide) await browser("set", "viewport", String(SIZE.wide - Math.max(0, Math.floor(view) - SIZE.centre)), String(SIZE.height));

      for (const state of states) await state.run();

      await browser("close");
    }
  } finally {
    await server.close();
  }

  expect(shots.flatMap(each => [each.checks.D2, each.checks.D5, each.checks.D6].some(check => check.status !== "pass") ? [each.name] : [])).toEqual([]);
}, 900_000);
