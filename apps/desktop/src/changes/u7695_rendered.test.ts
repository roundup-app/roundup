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

// Lines 6 and 22 change in every file: the first sits in the first function of a file, the second in the second.
const body = (tag: string) => Array.from({ length: 30 }, (_, n) => "  const value" + n + " = " + n + (n === 5 || n === 21 ? tag : "") + ";").join("\n") + "\n";

const COMPARISON: FileComparison = { base: "base", oldPath: "", newPath: "", status: "modified", old: text("o", body("")), new: text("n", body(" + 1")) };

// The 14-module fixture of U7679f, and the files the flows below name.
const FOURTEEN = Array.from({ length: 14 }, (_, n) => file("crates/module-" + String(n + 1).padStart(2, "0") + "/src/lib.rs"));

const FLOW_FILES = ["apps/a/src/run.ts", "apps/a/src/load.ts", "apps/a/src/types.ts", "crates/b/src/lib.rs"].map(file);

const symbol = (path: string, name: string, start: number, end: number, kind = "function", callable = true) => ({ key: path + "##" + name + "#" + kind, name, kind, path, old: { start, end }, new: { start, end }, status: "changed", callable });

const RUN = symbol("apps/a/src/run.ts", "run", 1, 10);

const OTHER = symbol("apps/a/src/run.ts", "other", 18, 26);

const LOAD = symbol("apps/a/src/load.ts", "load", 1, 10);

const ALIAS = symbol("apps/a/src/types.ts", "Alias", 1, 3, "type", false);

const TYPESCRIPT = { state: "done", symbols: [RUN, OTHER, LOAD, ALIAS], calls: [], flows: [], capped: false, oldSideResolvedThroughNewDependencies: false };

const found = (language: string, files: number) => ({ language, files, server: { found: true, name: language + "-server" } });

const LOOKUP = { languages: [found("typescript", 4), found("rust", 15), { language: "python", files: 2, server: { found: false, cause: { kind: "notInstalled", detail: "none" } } }] };

type Group = { repo: string; branch: string; base: string; files: ChangedFile[] };

const READY = "!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')";

const said = (words: string) => "document.querySelector('.changes-view')?.textContent.includes(" + JSON.stringify(words) + ")";

const LENS = (lens: string, checked = "") => "!!document.querySelector('.changes-side .app-segment[aria-label=\"" + lens + "\"]" + checked + "')";

const ITEM = (name: string) => ".changes-side [data-row=\"module\"][data-key=\"m:" + name + "\"]";

// U7695d: `just capture U7695d` writes each state at 1512 by 950 and at the centre's 388 px minimum, dark, over the U26 harness; the design critic judges layout and looks.
it("u7695d_the_logic_lists_are_captured_for_the_critic", async () => {
  const directory = captureDir("U7695d");

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

  /** The Daemon answers with the listing of the Tree target, each file's comparison and each trace. */
  const serve = () => {
    const files = [...FOURTEEN, ...FLOW_FILES];
    const groups: Group[] = [{ repo: "/p/transform-education", branch: "main", base: "main", files }];

    return read(`(() => {
      const handlers = window.__fake.app.handlers;
      const typescript = ${JSON.stringify(TYPESCRIPT)};
      const lookup = ${JSON.stringify(LOOKUP)};

      handlers["agent.ownedChanges"] = () => ({ groups: ${JSON.stringify(groups)} });
      handlers["agent.changedFiles"] = () => ({ files: ${JSON.stringify(files)} });
      handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path });
      handlers["agent.callPaths"] = ({ language }) => {
        if (language === undefined) return lookup;

        return language === "typescript" ? typescript : { state: "noServer" };
      };
      window.__fake.setStatus("agent-1", "idle", "ready");

      return window.__worktrees.refresh("agent-1").then(() => true);
    })()`);
  };

  const shot = async (state: string, ready: string) => {
    const name = `${lane}-${state}`;

    await until(ready);
    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, name + ".png"));

    const checks = await read<Checks>("window.__checks()");

    writeFileSync(join(directory, name + ".checks.json"), JSON.stringify(checks, null, 2));
    shots.push({ name, checks });
  };

  /** The Changes view over the Tree target, opened in the Logic lens: the Daemon answers first, then the icon opens the view. */
  const opened = async (wide: boolean) => {
    await serve();
    await until("!!document.querySelector('.changes-icon')");
    await browser("click", ".changes-icon");
    await until("!!document.querySelector('.changes-view .changes-side [data-row=\"overview\"]')");

    // The width that leaves the view the centre's minimum: the wide window less what the view has over it.
    const view = await read<number>("document.querySelector('.changes-view').getBoundingClientRect().width");

    if (!wide) await browser("set", "viewport", String(SIZE.wide - Math.max(0, Math.floor(view) - SIZE.centre)), String(SIZE.height));

    await browser("click", ".changes-view .app-segment[aria-label=\"Tree\"]");
    await browser("click", ".changes-side .app-segment[aria-label=\"Logic\"]");
    await until(LENS("Logic", "[data-checked]"));
  };

  const states: { name: string; run: () => Promise<void> }[] = [
    { name: "logic-closed", run: async () => { await browser("click", ITEM("apps/a")); await shot("logic-closed", READY + " && " + said("Functions and types")); } },
    { name: "logic-open", run: async () => { await browser("click", ITEM("apps/a")); await until(said("Functions and types")); await browser("click", ".changed-symbols .disclosure-trigger"); await shot("logic-open", "!!document.querySelector('.changed-symbols-list li')"); } },
    { name: "rust-not-traced", run: async () => { await browser("click", ITEM("crates/b")); await shot("rust-not-traced", said("Rust not traced")); } },
  ];

  const lanes = [{ name: "dark-wide", wide: true }, { name: "dark-centre", wide: false }];

  try {
    // Each state is a session of its own: a page that opened the view four times stops answering, and after `set viewport` this Chrome loads no further page in the session.
    for (const each of lanes) {
      for (const state of states) {
        lane = each.name;
        session = "changes-symbols-" + process.pid + "-" + lane + "-" + state.name;
        await browser("open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
        await browser("set", "media", "dark");
        await browser("set", "viewport", String(SIZE.wide), String(SIZE.height));
        await until("!!window.__fake && !!document.querySelector('.changes-icon')");
        await opened(each.wide);
        await state.run();
        await browser("close");
      }
    }
  } finally {
    await server.close();
  }

  expect(shots.flatMap(each => [each.checks.D2, each.checks.D5, each.checks.D6].some(check => check.status !== "pass") ? [each.name] : [])).toEqual([]);
}, 900_000);
