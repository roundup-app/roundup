import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import { agentBrowserExecutable } from "../testing/chromePage";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { FileComparison } from "@contracts/agent/FileComparison";

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

const LENS = (lens: string, checked = "") => `!!document.querySelector('.changes-side .app-segment[aria-label^="${lens} "]${checked}')`;

const OPENS = 10;

const ROUND_TRIP = 2000;

// U7924a: one page, one session; each open's number is in the failure.
const reopen = async (mode: "done" | "slow") => {
  const server = await appServer();
  const session = "changes-reopen-" + process.pid + "-" + mode;
  const browser = async (...args: string[]) => (await exec(agentBrowserExecutable, ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })).stdout;

  const read = async <T,>(expression: string, timeout = 60_000): Promise<T> => {
    // SAFETY: agent-browser wraps these constant DOM expressions in its JSON envelope.
    const result = JSON.parse((await exec(agentBrowserExecutable, ["--session", session, "--json", "eval", expression], { maxBuffer: 8 * 1024 * 1024, timeout })).stdout) as { success: boolean; data: { result: T }; error?: string };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };

  const until = (expression: string) => browser("wait", "--fn", expression);

  const files = [...FOURTEEN, ...FLOW_FILES];
  const groups: Group[] = [{ repo: "/p/transform-education", checkout: "/p/transform-education", branch: "main", base: "main", files }];

  try {
    await browser("open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
    await browser("set", "media", "dark");
    await browser("set", "viewport", String(SIZE.wide), String(SIZE.height));
    await until("!!window.__fake && !!document.querySelector('.changes-icon')");
    await read(`(() => {
      const handlers = window.__fake.app.handlers;
      const typescript = ${JSON.stringify(TYPESCRIPT)};
      const lookup = ${JSON.stringify(LOOKUP)};

      handlers["agent.ownedChanges"] = () => ({ groups: ${JSON.stringify(groups)} });
      handlers["agent.changedFiles"] = () => ({ files: ${JSON.stringify(files)} });
      handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path });
      handlers["agent.callPaths"] = ({ language }) => {
        if (language === undefined) return lookup;
        if (${JSON.stringify(mode)} === "slow") return new Promise(() => {});

        return language === "typescript" ? typescript : { state: "noServer" };
      };
      window.__fake.setStatus("agent-1", "idle", "ready");

      return window.__worktrees.refresh("agent-1").then(() => true);
    })()`);
    await until("!!document.querySelector('.changes-icon')");

    for (let open = 1; open <= OPENS; open++) {
      try {
        await browser("click", ".changes-icon");
        await until("!!document.querySelector('.changes-view .changes-side [data-row=\"overview\"]')");

        await browser("click", ".changes-view .app-segment[aria-label=\"Tree\"]");
        await browser("click", ".changes-side .app-segment[aria-label^=\"Flows \"]");

        await until(LENS("Flows", "[data-checked]"));

        if (mode === "done") {
          await browser("click", `.changes-side [data-row="module"]`);
          await until(`!!document.querySelector('.flow-tree [data-row="call"]')`);
        }

        const started = Date.now();

        expect(await read<number>("1 + 1", ROUND_TRIP)).toBe(2);
        expect(Date.now() - started).toBeLessThan(ROUND_TRIP);
        expect(await read<number>("document.querySelectorAll('.changes-side .app-segment').length")).toBeGreaterThan(0);
        await read("window.__checks()");
        await browser("press", "Escape");
        await until("!document.querySelector('.changes-view')");
      } catch (error) {
        throw new Error("open " + open + " of " + OPENS + " (callPaths " + mode + ") did not answer: " + String(error));
      }
    }
  } finally {
    await browser("close").catch(() => undefined);
    await server.close();
  }
};

// U7924a: the Changes view reopens ten times in one page, with call paths ready and unanswered.
it("u7924a_the_changes_view_reopens_ten_times_in_one_page_and_the_page_keeps_answering", async () => {
  await reopen("done");
  await reopen("slow");
}, 300_000);
