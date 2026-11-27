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
import type { DefectFindings } from "@contracts/agent/DefectFindings";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { Spot } from "@contracts/agent/Spot";
import { copy } from "./copy";

const exec = promisify(execFile);

const SIZE = { wide: 1512, centre: 388, height: 950 };

const sized = (path: string, added: number, removed: number): ChangedFile => ({ path, status: "modified", line: 1, counts: { added, removed }, blob: null });

const text = (revision: string, body: string) => ({ kind: "text", revision, text: body }) as const;

const line = (n: number, tag: string) => "  const value" + n + " = " + n + tag + ";";

const body = (tag: string) => Array.from({ length: 30 }, (_, n) => line(n, n === 5 ? tag : "")).join("\n") + "\n";

const COMPARISON: FileComparison = { base: "base", oldPath: "", newPath: "", status: "modified", old: text("o", body("")), new: text("n", body(" + 1")) };

const CHANGED: [number, number][] = [[180, 33], [40, 8], [22, 3], [12, 0], [9, 2], [6, 1], [30, 12], [4, 0], [2, 1], [15, 5], [3, 0], [60, 20], [8, 2], [1, 1]];

const module = (n: number) => "crates/module-" + String(n + 1).padStart(2, "0");

// Fourteen modules of very different size, a test for every second one, two modules that share the name core, and a noise file.
const FILES = [
  ...CHANGED.map(([added, removed], n) => sized(module(n) + "/src/lib.rs", added, removed)),
  ...CHANGED.flatMap((_, n) => n % 2 === 0 ? [sized(module(n) + "/tests/it.rs", 10, 4)] : []),
  sized("apps/core/src/a.ts", 6, 0),
  sized("crates/core/src/a.rs", 3, 0),
  sized("README.md", 1, 1),
];

const REPEATS: Spot[] = [4, 8].map(n => ({ source: { kind: "repeats" }, path: module(n) + "/src/lib.rs", start: 6, end: 6, other: { path: module(n + 1) + "/src/lib.rs", start: 6, end: 6 }, stale: false }));

const FINDINGS: DefectFindings = { state: "found", findings: [1, 6].map(n => ({ path: module(n) + "/src/lib.rs", start: 6, end: 6, source: line(5, " + 1"), text: "This line ignores a missing entry.", label: "issue" })) };

const NOTE = "Every caller of this module moves together";

type Group = { repo: string; checkout: string; branch: string; base: string; files: ChangedFile[] };

const ITEM = (name: string) => '.changes-side [data-row="module"][data-key="m:' + name + '"]';

const present = (expression: string) => "!!document.querySelector(" + JSON.stringify(expression) + ")";

const TAB = (lens: string, checked = "") => present('.changes-side .app-segment[aria-label^="' + lens + ' "]' + checked);

// U8009d: `just capture U8009d` writes each lens, and the Modules list holding a ✓, a dot of each signal the harness can raise, a shared name and the open row, at 1512 by 950 and at the centre's 388 px minimum, dark and light, over the U26 harness; the design critic judges layout and looks.
it("u8009d_the_rows_and_tabs_are_captured_for_the_critic", async () => {
  const directory = captureDir("U8009d");

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

  const click = (name: string) => browser("find", "role", "button", "click", "--name", name, "--exact");

  /** The Daemon lists `files`, reads each as a small change, and answers the repeat scan and the defect pass. */
  const serve = (files: ChangedFile[]) => {
    const groups: Group[] = [{ repo: "/p/transform-education", checkout: "/p/transform-education", branch: "main", base: "main", files }];

    return read(`(() => {
      const handlers = window.__fake.app.handlers;

      handlers["agent.ownedChanges"] = () => ({ groups: ${JSON.stringify(groups)} });
      handlers["agent.changedFiles"] = () => ({ files: ${JSON.stringify(files)} });
      handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path });
      handlers["agent.repeatScan"] = () => ({ spots: ${JSON.stringify(REPEATS)}, complete: true });
      handlers["agent.findDefects"] = () => (${JSON.stringify(FINDINGS)});
      window.__fake.setStatus("agent-1", "idle", "ready");

      return window.__worktrees.refresh("agent-1").then(() => true);
    })()`);
  };

  const shot = async (state: string, ready: string) => {
    const name = lane + "-" + state;

    await until(ready);
    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, name + ".png"));

    const checks = await read<Checks>("window.__checks()");

    writeFileSync(join(directory, name + ".checks.json"), JSON.stringify(checks, null, 2));
    shots.push({ name, checks });
  };

  /** The Changes view over the listing: the Daemon answers first, then the icon opens the view on the Overview; `wide` false narrows the window to the centre's minimum. */
  const opened = async (wide: boolean) => {
    await serve(FILES);
    await until("!!document.querySelector('.changes-icon')");
    await browser("click", ".changes-icon");
    await until("!!document.querySelector('.changes-view .changes-side [data-row=\"overview\"]')");

    // The width that leaves the view the centre's minimum: the wide window less what the view has over it.
    const view = await read<number>("document.querySelector('.changes-view').getBoundingClientRect().width");

    if (!wide) await browser("set", "viewport", String(SIZE.wide - Math.max(0, Math.floor(view) - SIZE.centre)), String(SIZE.height));
  };

  const lens = async (name: string) => {
    await browser("click", '.changes-side .app-segment[aria-label^="' + name + ' "]');
    await until(TAB(name, "[data-checked]"));
  };

  const lensState = (name: string) => ({ name: name.toLowerCase(), run: async () => { await lens(name); await shot(name.toLowerCase(), present(".changes-lens-line")); } });

  /**
   * Modules over the Tree target with the repeat scan answered: the wide lanes add a defect pass, a note on the first module and its viewed mark, which opens the next.
   * At the centre's minimum width a two-file module, a defect pass, the note form and the viewed mark each freeze or crash this Chrome's page on main too, so those lanes open a one-file module and add nothing.
   */
  const signals = async (wide: boolean) => {
    const first = wide ? "crates/module-01" : "apps/core";

    await browser("click", '.changes-view .app-segment[aria-label="Tree"]');

    if (wide) {
      await until(present('.findings button[aria-label="' + copy.findDefects + '"]'));
      await click(copy.findDefects);
    }

    await lens("Modules");
    await until(present('.changes-row-dot[data-signal="' + (wide ? "finding" : "repeat") + '"]'));
    await browser("click", ITEM(first));
    await until(present('.changes-row[data-key="m:' + first + '"][data-open="true"]'));

    if (wide) {
      await click(copy.noteOn.module);
      await until(present(".note-form"));
      await browser("find", "label", "Note", "fill", NOTE);
      await click("Save");
      await until(present('.changes-row[data-key="m:' + first + '"][aria-label*="1 note"]'));
      await read("(() => { document.querySelector('.diff-content').focus(); return true; })()");
      await browser("press", "v");
      await until(present('.changes-row-state[data-state="viewed"]'));
    }

    // A pointer at the window's left edge opens the Rail over the list.
    await browser("mouse", "move", "400", "800");
    await shot("modules-signals", present('.changes-row-dot[data-signal="repeat"]') + " && " + present(".changes-row-folder") + " && " + present('.changes-row[data-open="true"]'));
  };

  const states: { name: string; run: (wide: boolean) => Promise<void> }[] = [...["Flows", "Modules", "Logic", "Tests"].map(lensState), { name: "signals", run: signals }];

  const lanes = [{ name: "dark-wide", scheme: "dark", wide: true }, { name: "dark-centre", scheme: "dark", wide: false }, { name: "light-wide", scheme: "light", wide: true }, { name: "light-centre", scheme: "light", wide: false }];

  try {
    // Each state is a session of its own: a page that opened the view several times stops answering, and after `set viewport` this Chrome loads no further page in the session.
    for (const each of lanes) {
      for (const state of states) {
        lane = each.name;
        session = "changes-rows-" + process.pid + "-" + lane + "-" + state.name;
        await browser("open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
        await browser("set", "media", each.scheme);
        await browser("set", "viewport", String(SIZE.wide), String(SIZE.height));
        await until("!!window.__fake && !!document.querySelector('.changes-icon')");
        await opened(each.wide);
        await state.run(each.wide);
        await browser("close");
      }
    }
  } finally {
    await server.close();
  }

  expect(shots.flatMap(each => [each.checks.D1, each.checks.D2, each.checks.D5, each.checks.D6].some(check => check.status !== "pass") ? [each.name] : [])).toEqual([]);
}, 1_200_000);
