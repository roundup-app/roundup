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

const FLOW_FILES = ["apps/a/src/run.ts", "apps/a/src/load.ts", "apps/a/src/types.ts", "docs/README.md", "pnpm-lock.yaml"].map(file);

const symbol = (path: string, name: string, start: number, end: number, kind = "function", callable = true) => ({ key: path + "##" + name + "#" + kind, name, kind, path, old: { start, end }, new: { start, end }, status: "changed", callable });

const RUN = symbol("apps/a/src/run.ts", "run", 1, 10);

const OTHER = symbol("apps/a/src/run.ts", "other", 18, 26);

const LOAD = symbol("apps/a/src/load.ts", "load", 1, 10);

const ALIAS = symbol("apps/a/src/types.ts", "Alias", 1, 3, "type", false);

const call = (of: { key: string; name: string; kind: string; path: string }, status = "changed") => ({ key: of.key, name: of.name, kind: of.kind, path: of.path, status });

const node = (of: { key: string }, calls: unknown[] = []) => ({ key: of.key, status: "changed", cycle: false, calls });

const LEGACY = { key: "apps/a/src/legacy.ts##legacy#function", name: "legacy", kind: "function", path: "apps/a/src/legacy.ts", status: "removed" };

const TYPESCRIPT = {
  state: "done",
  symbols: [RUN, OTHER, LOAD, ALIAS],
  calls: [
    { key: RUN.key, outgoing: [call(LOAD), LEGACY], incoming: [], incoming_unchanged: 0 },
    { key: OTHER.key, outgoing: [call(LOAD)], incoming: [], incoming_unchanged: 0 },
    { key: LOAD.key, outgoing: [], incoming: [call(RUN), call(OTHER)], incoming_unchanged: 1 },
  ],
  flows: [node(RUN, [node(LOAD)]), node(OTHER, [node(LOAD)])].map(tree => ({ entry: tree.key, tree, capped: false })),
  capped: false,
  oldSideResolvedThroughNewDependencies: false,
};

const found = (language: string, files: number) => ({ language, files, server: { found: true, name: language + "-server" } });

const LOOKUP = { languages: [found("typescript", 4), found("rust", 14), { language: "python", files: 2, server: { found: false, cause: { kind: "notInstalled", detail: "none" } } }] };

type Group = { repo: string; checkout: string; branch: string; base: string; files: ChangedFile[] };

const READY = "!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')";

const said = (words: string) => "document.querySelector('.changes-view')?.textContent.includes(" + JSON.stringify(words) + ")";

const LENS = (lens: string, checked = "") => "!!document.querySelector('.changes-side .app-segment[aria-label^=\"" + lens + " \"]" + checked + "')";

// U7683h: `just capture U7683h` writes each state at 1512 by 950 and at the centre's 388 px minimum, dark, over the U26 harness; the design critic judges layout and looks.
it("u7683h_the_flows_lens_is_captured_for_the_critic", async () => {
  const directory = captureDir("U7683h");

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

  /** The Daemon answers with the listing of the Tree target, each file's comparison and each trace: "done", "slow" (never answers) or "failed". */
  const serve = (mode: "done" | "slow" | "failed") => {
    const files = [...FOURTEEN, ...FLOW_FILES];
    const groups: Group[] = [{ repo: "/p/transform-education", checkout: "/p/transform-education", branch: "main", base: "main", files }];

    return read(`(() => {
      const handlers = window.__fake.app.handlers;
      const typescript = ${JSON.stringify(TYPESCRIPT)};
      const lookup = ${JSON.stringify(LOOKUP)};

      handlers["agent.ownedChanges"] = () => ({ groups: ${JSON.stringify(groups)} });
      handlers["agent.changedFiles"] = () => ({ files: ${JSON.stringify(files)} });
      handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path });
      handlers["agent.callPaths"] = ({ language }) => {
        if (language === undefined) return lookup;
        if (${JSON.stringify(mode)} === "slow") return new Promise(() => {});
        if (${JSON.stringify(mode)} === "failed") return { state: "failed", cause: { kind: "error", detail: "the server crashed" } };

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

  /** The Changes view over the Tree target, opened in the Flows lens: the Daemon answers first, then the icon opens the view. */
  const opened = async (mode: "done" | "slow" | "failed", wide: boolean) => {
    await serve(mode);
    await until("!!document.querySelector('.changes-icon')");
    await browser("click", ".changes-icon");
    await until("!!document.querySelector('.changes-view .changes-side [data-row=\"module\"]')");

    // The width that leaves the view the centre's minimum: the wide window less what the view has over it.
    const view = await read<number>("document.querySelector('.changes-view').getBoundingClientRect().width");

    if (!wide) await browser("set", "viewport", String(SIZE.wide - Math.max(0, Math.floor(view) - SIZE.centre)), String(SIZE.height));

    await browser("click", ".changes-view .app-segment[aria-label=\"Tree\"]");
    await browser("click", ".changes-side .app-segment[aria-label^=\"Flows \"]");
    await until(LENS("Flows", "[data-checked]"));
  };

  const states: { name: string; mode: "done" | "slow" | "failed"; run: () => Promise<void> }[] = [
    { name: "flows", mode: "done", run: () => shot("flows", "!!document.querySelector('.changes-overview [data-entry]') && " + said("Rust not traced")) },
    { name: "flow-open", mode: "done", run: async () => { await browser("click", '.changes-side [data-row="module"]'); await shot("flow-open", READY + " && !!document.querySelector('.flow-tree [data-row=\"call\"]')"); } },
    { name: "tracing", mode: "slow", run: () => shot("tracing", said("Tracing TypeScript calls")) },
    { name: "failed", mode: "failed", run: () => shot("failed", said("Couldn't trace TypeScript calls")) },
  ];

  const lanes = [{ name: "dark-wide", wide: true }, { name: "dark-centre", wide: false }];

  try {
    // Each state is a session of its own: a page that opened the view four times stops answering, and after `set viewport` this Chrome loads no further page in the session.
    for (const each of lanes) {
      for (const state of states) {
        lane = each.name;
        session = "changes-flows-" + process.pid + "-" + lane + "-" + state.name;
        await browser("open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
        await browser("set", "media", "dark");
        await browser("set", "viewport", String(SIZE.wide), String(SIZE.height));
        await until("!!window.__fake && !!document.querySelector('.changes-icon')");
        await opened(state.mode, each.wide);
        await state.run();
        await browser("close");
      }
    }
  } finally {
    await server.close();
  }

  expect(shots.flatMap(each => [each.checks.D2, each.checks.D5, each.checks.D6].some(check => check.status !== "pass") ? [each.name] : [])).toEqual([]);
}, 900_000);
