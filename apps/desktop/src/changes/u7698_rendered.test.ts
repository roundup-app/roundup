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
import type { Explanation } from "@contracts/agent/Explanation";
import type { FileComparison } from "@contracts/agent/FileComparison";
import { copy } from "./copy";

const exec = promisify(execFile);

const SIZE = { width: 1512, height: 950 };

const file = (path: string, blob: string): ChangedFile => ({ path, status: "modified", line: 1, counts: { added: 3, removed: 2 }, blob });

const text = (revision: string, body: string) => ({ kind: "text", revision, text: body }) as const;

// Lines 6 and 22 change in the file.
const body = (tag: string) => Array.from({ length: 30 }, (_, n) => "  const value" + n + " = " + n + (n === 5 || n === 21 ? tag : "") + ";").join("\n") + "\n";

const COMPARISON: FileComparison = { base: "base", oldPath: "", newPath: "", status: "modified", old: text("o", body("")), new: text("n", body(" + 1")) };

const PATH = "crates/module-01/src/lib.rs";

const WORDS: Explanation = { state: "explained", form: "words", text: "The loader now asks the cache first and falls back to the disk read only when the cache has no entry." };

const DIAGRAM: Explanation = { state: "explained", form: "diagram", text: "Before\nrun -> load\nAfter\nrun -> cache -> load" };

const said = (words: string) => "document.querySelector('.explained')?.textContent.includes(" + JSON.stringify(words) + ")";

// U7698f: `just capture U7698f` writes each state at 1512 by 950, dark, over the U26 harness; the design critic judges layout and looks.
it("u7698f_the_explanation_is_captured_for_the_critic", async () => {
  const directory = captureDir("U7698f");

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

  /** The Daemon lists the file at `blob` and answers `agent.explain` with `answer`, or never. */
  const serve = (blob: string, answer: Explanation | "never") => {
    const files = [file(PATH, blob)];
    const groups = [{ repo: "/p/transform-education", branch: "main", base: "main", files }];

    return read(`(() => {
      const handlers = window.__fake.app.handlers;

      handlers["agent.ownedChanges"] = () => ({ groups: ${JSON.stringify(groups)} });
      handlers["agent.changedFiles"] = () => ({ files: ${JSON.stringify(files)} });
      handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path });
      handlers["agent.explain"] = () => ${answer === "never" ? "new Promise(() => {})" : "(" + JSON.stringify(answer) + ")"};
      window.__fake.setStatus("agent-1", "idle", "ready");

      return window.__worktrees.refresh("agent-1").then(() => true);
    })()`);
  };

  const shot = async (name: string, ready: string) => {
    await until(ready);
    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, name + ".png"));

    const checks = await read<Checks>("window.__checks()");

    writeFileSync(join(directory, name + ".checks.json"), JSON.stringify(checks, null, 2));
    shots.push({ name, checks });
  };

  const choose = (target: string) => read(`document.querySelector('.changes-view .app-segment[aria-label="${target}"]')?.click() ?? false`);

  /** The Changes view over the Tree target with the first module open and its diff drawn. */
  const opened = async (blob: string, answer: Explanation | "never") => {
    await serve(blob, answer);
    await until("!!document.querySelector('.changes-icon')");
    await browser("click", ".changes-icon");
    await until("!!document.querySelector('.changes-view .changes-side [data-row=\"overview\"]')");
    await choose("Tree");
    await until("!!document.querySelector('.changes-side [data-row=\"module\"]')");
    await browser("click", '.changes-side [data-row="module"]');
    await until("!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')");
  };

  const ask = (name: string) => read(`document.querySelector('.changes-view button[aria-label="${name}"]')?.click() ?? false`);

  const states: { name: string; blob: string; answer: Explanation | "never"; run: () => Promise<void> }[] = [
    { name: "asking", blob: "one", answer: "never", run: async () => { await ask(copy.explainWords); await shot("asking", said(copy.readingBack)); } },
    { name: "words", blob: "one", answer: WORDS, run: async () => { await ask(copy.explainWords); await shot("words", said(copy.readbackCredit)); } },
    { name: "diagram", blob: "one", answer: DIAGRAM, run: async () => { await ask(copy.explainDiagram); await shot("diagram", said(copy.readbackCredit) + " && !!document.querySelector('.explained .readback-figure')"); } },
    {
      name: "stale",
      blob: "one",
      answer: WORDS,
      run: async () => {
        await ask(copy.explainWords);
        await until(said(copy.readbackCredit));
        // The file's blob id moves: the Tree list reads again when the target changes.
        await serve("two", WORDS);
        await choose("Branch");
        await choose("Tree");
        await until("!!document.querySelector('.changes-side [data-row=\"module\"]')");
        await browser("click", '.changes-side [data-row="module"]');
        await shot("stale", said(copy.changedSinceReadback));
      },
    },
  ];

  try {
    // Each state is a session of its own: a page that opened the view many times stops answering (#7924).
    for (const state of states) {
      session = "changes-explain-" + process.pid + "-" + state.name;
      await browser("open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
      await browser("set", "media", "dark");
      await browser("set", "viewport", String(SIZE.width), String(SIZE.height));
      await until("!!window.__fake && !!document.querySelector('.changes-icon')");
      await opened(state.blob, state.answer);
      await state.run();
      await browser("close");
    }
  } finally {
    await server.close();
  }

  // D2, D3, D5, D6 and D10 hold on every state (U7698f); every capture is written before one fails the run.
  expect(shots.flatMap(each => [each.checks.D2, each.checks.D3, each.checks.D5, each.checks.D6, each.checks.D10].some(check => check.status !== "pass") ? [each.name] : [])).toEqual([]);
}, 900_000);
