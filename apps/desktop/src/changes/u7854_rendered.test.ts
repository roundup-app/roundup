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

const file = (path: string, over: Partial<ChangedFile> = {}): ChangedFile => ({ path, status: "modified", line: 1, counts: { added: 3, removed: 2 }, blob: null, ...over });

const text = (revision: string, body: string) => ({ kind: "text", revision, text: body }) as const;

const body = (tag: string) => Array.from({ length: 30 }, (_, n) => "  const value" + n + " = " + n + (n === 5 ? tag : "") + ";").join("\n") + "\n";

const COMPARISON: FileComparison = { base: "base", oldPath: "", newPath: "", status: "modified", old: text("o", body("")), new: text("n", body(" + 1")) };

// The owner's case: an Agent in a shared checkout with one untracked, one dotfile and one modified file.
const OWNER = [file(".claude/rules/git.md", { status: "untracked", counts: { added: 5, removed: 0 } }), file(".oxfmtrc.json", { counts: { added: 5, removed: 1 } }), file("vite.config.ts", { counts: { added: 25, removed: 7 } })];

type Group = { repo: string; checkout: string; branch: string; base: string; files: ChangedFile[] };

const READY = "!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')";

const said = (words: string) => `document.querySelector('.changes-view')?.textContent.includes(${JSON.stringify(words)})`;

// U7854f: `just capture U7854f` writes each state at 1512 by 950 and at the centre's 388 px minimum, dark and light, over the U26 harness; the design critic judges layout and looks against the approved prototype.
it("u7854f_the_changes_layout_is_captured_for_the_critic", async () => {
  const directory = captureDir("U7854f");

  if (!directory) return;

  const server = await appServer();
  const base = new URL("/src/changes/u2540.html?shared", server.resolvedUrls.local[0] ?? "").href;
  let session = "";

  const browser = async (...args: string[]) => (await exec(agentBrowserExecutable, ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })).stdout;

  const read = async <T,>(expression: string): Promise<T> => {
    // SAFETY: agent-browser wraps these constant DOM expressions in its JSON envelope.
    const result = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };

  const until = (expression: string) => browser("wait", "--fn", expression);

  /** The Daemon answers with `groups` and each file's comparison; `failing` makes every comparison fail with the raw code the owner met. */
  const serve = (groups: Group[], failing = false) => read(`(() => {
    const groups = ${JSON.stringify(groups)};
    const handlers = window.__fake.app.handlers;

    handlers["agent.ownedChanges"] = () => ({ groups });
    handlers["agent.compareFile"] = ${failing ? '() => { throw new Error("no_worktree: 16"); }' : `({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path })`};
    window.__fake.setStatus("agent-1", "idle", "ready");

    return window.__worktrees.refresh("agent-1").then(() => true);
  })()`);

  const shots: { name: string; checks: Checks }[] = [];
  let lane = "";

  const shot = async (state: string, ready: string) => {
    const name = `${lane}-${state}`;

    await until(ready);
    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, `${name}.png`));

    const checks = await read<Checks>("window.__checks()");

    writeFileSync(join(directory, `${name}.checks.json`), JSON.stringify(checks, null, 2));
    shots.push({ name, checks });
  };

  const one = (files: ChangedFile[]): Group[] => [{ repo: "/p/transform-education", checkout: "/p/transform-education", branch: "main", base: "main", files }];

  /** The Changes view over `groups`, closed and opened again so each state reads afresh. */
  const opened = async (groups: Group[], failing = false) => {
    await read("(() => { document.querySelector('.changes-view [data-button=\"quiet\"]:last-of-type')?.click(); return true; })()");
    await serve(groups, failing);
    await until("!!document.querySelector('.changes-icon')");
    await browser("click", ".changes-icon");
    await until("!!document.querySelector('.changes-view .changes-side')");

    // U7679c: the view opens on the Overview and reads no file; a listing that read fails has no module to choose.
    if (!failing) {
      await until("!!document.querySelector('.changes-side [data-row=\"module\"]')");
      await browser("click", '.changes-side [data-row="module"]');
    }
  };

  const unfold = async () => {
    await read("(() => { document.querySelector('.changes-side [data-row=\"module\"]').focus(); return true; })()");
    await browser("press", "ArrowRight");
  };

  const states: { name: string; run: () => Promise<void> }[] = [
    { name: "owner-folded", run: async () => { await opened(one(OWNER)); await shot("owner-folded", READY); } },
    { name: "owner-unfolded", run: async () => { await opened(one(OWNER)); await until(READY); await unfold(); await shot("owner-unfolded", "!!document.querySelector('.changes-side [data-row=\"file\"]')"); } },
    { name: "two-groups", run: async () => { await opened([...one(OWNER), { repo: "/p/te", checkout: "/p/te", branch: "feature/a-long-branch-name", base: "main", files: [file("a.ts")] }]); await shot("two-groups", READY); } },
    { name: "failure", run: async () => { await opened(one(OWNER), true); await shot("failure", said("Retry")); } },
  ];

  try {
    // One session per scheme and width: after `set viewport` this Chrome loads no further page in the session.
    for (const scheme of ["dark", "light"] as const) {
      for (const name of ["wide", "centre"] as const) {
        lane = `${scheme}-${name}`;
        session = `changes-layout-${process.pid}-${lane}`;
        await browser("open", base);
        await browser("set", "media", scheme);
        await browser("set", "viewport", String(SIZE.wide), String(SIZE.height));
        await until("!!window.__fake && !!document.querySelector('.changes-icon')");
        await browser("click", ".changes-icon");
        await until("!!document.querySelector('.changes-view .changes-side')");

        // The width that leaves the view the centre's minimum: the wide window less what the view has over it.
        const view = await read<number>("document.querySelector('.changes-view').getBoundingClientRect().width");

        if (name === "centre") await browser("set", "viewport", String(SIZE.wide - Math.max(0, Math.floor(view) - SIZE.centre)), String(SIZE.height));

        for (const state of states) await state.run();

        await browser("close");
      }
    }
  } finally {
    await server.close();
  }

  expect(shots.flatMap(each => [each.checks.D2, each.checks.D5, each.checks.D6].some(check => check.status !== "pass") ? [each.name] : [])).toEqual([]);
}, 540_000);
