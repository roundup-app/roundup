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

const text = (revision: string, body: string) => ({ kind: "text", revision, text: body }) as const;

const body = (tag: string) => Array.from({ length: 30 }, (_, n) => "  const value" + n + " = " + n + (n === 5 ? tag : "") + ";").join("\n") + "\n";

const COMPARISON: FileComparison = { base: "base", oldPath: "", newPath: "", status: "modified", old: text("o", body("")), new: text("n", body(" + 1")) };

// Three modules, the first with a test too; each file holds the blob `blob`, so a second listing with another blob is a change.
const MODULES = (blob: string): ChangedFile[] => ["crates/alpha/src/lib.rs", "crates/alpha/tests/it.rs", "crates/beta/src/lib.rs", "crates/gamma/src/lib.rs"].map(path => ({ path, status: "modified", line: 1, counts: { added: 3, removed: 2 }, blob: path + "@" + blob }));

const READY = "!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')";

const said = (words: string) => `document.querySelector('.changes-view')?.textContent.includes(${JSON.stringify(words)})`;

const OVER = (module: string) => `document.querySelector('.module-slot .module-file')?.dataset.path.includes('/${module}/')`;

// U7680f: `just capture U7680f` writes each state at 1512 by 950 and at the centre's 388 px minimum, dark, over the U26 harness; the design critic judges layout and looks.
it("u7680f_viewed_states_are_captured_for_the_critic", async () => {
  const directory = captureDir("U7680f");

  if (!directory) return;

  const server = await appServer();
  const shots: { name: string; checks: Checks }[] = [];
  let session = "";
  let size = "";

  const browser = async (...args: string[]) => (await exec(agentBrowserExecutable, ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })).stdout;

  const read = async <T,>(expression: string): Promise<T> => {
    // SAFETY: agent-browser wraps these constant DOM expressions in its JSON envelope.
    const result = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };

  const until = (expression: string) => browser("wait", "--fn", expression);

  /** The Daemon answers with `files` and each file's comparison; the Rail reads what the Agent owns again. */
  const serve = (files: ChangedFile[]) => read(`(() => {
    const handlers = window.__fake.app.handlers;

    handlers["agent.ownedChanges"] = () => ({ groups: [{ repo: "/p/transform-education", branch: "main", base: "main", files: ${JSON.stringify(files)} }] });
    handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path });
    window.__fake.setStatus("agent-1", "idle", "ready");

    return window.__worktrees.refresh("agent-1").then(() => true);
  })()`);

  const shot = async (state: string, ready: string) => {
    const name = `${size}-${state}`;

    await until(ready);
    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, `${name}.png`));

    const checks = await read<Checks>("window.__checks()");

    writeFileSync(join(directory, `${name}.checks.json`), JSON.stringify(checks, null, 2));
    shots.push({ name, checks });
  };

  /** The Changes view over `files`, closed and opened again so each state reads afresh: a listing of no file first drops the marks an earlier state made. */
  const opened = async (files: ChangedFile[]) => {
    await serve([]);
    await until(said("No changes against remote main"));
    await read("(() => { document.querySelector('.changes-view [data-button=\"quiet\"]:last-of-type')?.click(); return true; })()");
    await serve(files);
    await until("!!document.querySelector('.changes-icon')");
    await browser("click", ".changes-icon");
    await browser("click", '.changes-side .app-segment[aria-label="Modules"]');
    await until("!!document.querySelector('.changes-side [data-row=\"module\"]')");
  };

  /** The module `name` opens, its first screen drawn. */
  const open = async (name: string) => {
    await browser("click", `.changes-side [data-key="m:crates/${name}"]`);
    await until(OVER(name));
    await until(READY);
  };

  /** The open module's Viewed button is pressed, and `next` (when there is one) opens. */
  const mark = async (counted: string, next?: string) => {
    await browser("click", ".module-head button");
    await until(said(counted));

    if (next) {
      await until(OVER(next));
      await until(READY);
    }
  };

  const states: { name: string; run: () => Promise<void> }[] = [
    { name: "viewed", run: async () => { await opened(MODULES("one")); await open("alpha"); await mark("1 of 3 viewed", "beta"); await shot("viewed", said("Viewed")); } },
    { name: "changed", run: async () => { await opened(MODULES("one")); await open("alpha"); await mark("1 of 3 viewed", "beta"); await serve(MODULES("two")); await open("alpha"); await shot("changed", said("Changed since you viewed it")); } },
    { name: "all-viewed", run: async () => { await opened(MODULES("one")); await open("alpha"); await mark("1 of 3 viewed", "beta"); await mark("2 of 3 viewed", "gamma"); await mark("All 3 viewed"); await shot("all-viewed", said("All 3 viewed")); } },
  ];

  // Each size is a session of its own: after `set viewport` this Chrome loads no further page in the session.
  const sizes = [{ name: "dark-wide", wide: true }, { name: "dark-centre", wide: false }];

  try {
    for (const each of sizes) {
      size = each.name;
      session = `changes-viewed-${process.pid}-${size}`;
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
