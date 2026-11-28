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

type Group = { repo: string; checkout: string; branch: string; base: string; files: ChangedFile[] };

const present = (expression: string) => "!!document.querySelector(" + JSON.stringify(expression) + ")";

const TAB = (lens: string, checked = "") => present('.changes-side .app-segment[aria-label^="' + lens + ' "]' + checked);

// U8012c: `just capture U8012c` writes the Modules list over the 14-module fixture with its change map holding viewed, open and unviewed blocks and a one-line item at the floor, at 1512 by 950 and at the centre's 388 px minimum, dark and light, over the U26 harness; the design critic judges the place and the looks.
it("u8012c_the_map_is_captured_for_the_critic", async () => {
  const directory = captureDir("U8012c");

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

  /** The Daemon lists `files`, reads each as a small change, and answers the repeat scan and the defect pass. */
  const serve = (files: ChangedFile[]) => {
    const groups: Group[] = [{ repo: "/p/transform-education", checkout: "/p/transform-education", branch: "main", base: "main", files }];

    return read(`(() => {
      const handlers = window.__fake.app.handlers;

      handlers["agent.ownedChanges"] = () => ({ groups: ${JSON.stringify(groups)} });
      handlers["agent.changedFiles"] = () => ({ files: ${JSON.stringify(files)} });
      handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path });
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
    await until("!!document.querySelector('.changes-view .changes-side [data-row=\"module\"]')");

    // The width that leaves the view the centre's minimum: the wide window less what the view has over it.
    const view = await read<number>("document.querySelector('.changes-view').getBoundingClientRect().width");

    if (!wide) await browser("set", "viewport", String(SIZE.wide - Math.max(0, Math.floor(view) - SIZE.centre)), String(SIZE.height));
  };

  const lens = async (name: string) => {
    await browser("click", '.changes-side .app-segment[aria-label^="' + name + ' "]');
    await until(TAB(name, "[data-checked]"));
  };

  /** The first module opens and, on the wide lanes, is marked viewed, which opens the next: a filled, an open and many unviewed blocks. At the centre's minimum the viewed mark freezes this Chrome's page, so those lanes open a block's item and mark nothing. */
  const mapped = async (wide: boolean) => {
    await lens("Modules");
    await browser("click", ".change-map-block:nth-child(2)");
    await until(present(".changes-row[data-open=\"true\"]"));

    if (wide) {
      await read("(() => { document.querySelector('.diff-content').focus(); return true; })()");
      await browser("press", "v");
      await until(present(".change-map-block[data-viewed]"));
    }

    await browser("mouse", "move", "400", "800");
    await shot("modules-map", present(".change-map-block[data-open]") + " && " + present(".change-map-block:not([data-viewed]):not([data-open])"));
  };

  const lanes = [{ name: "dark-wide", scheme: "dark", wide: true }, { name: "dark-centre", scheme: "dark", wide: false }, { name: "light-wide", scheme: "light", wide: true }, { name: "light-centre", scheme: "light", wide: false }];

  try {
    // Each lane is a session of its own: a page that opened the view several times stops answering.
    for (const each of lanes) {
      lane = each.name;
      session = "changes-map-" + process.pid + "-" + lane;
      await browser("open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
      await browser("set", "media", each.scheme);
      await browser("set", "viewport", String(SIZE.wide), String(SIZE.height));
      await until("!!window.__fake && !!document.querySelector('.changes-icon')");
      await opened(each.wide);
      await mapped(each.wide);
      await browser("close");
    }
  } finally {
    await server.close();
  }

  expect(shots.flatMap(each => [each.checks.D1, each.checks.D2, each.checks.D5, each.checks.D6].some(check => check.status !== "pass") ? [each.name] : [])).toEqual([]);
}, 1_200_000);
