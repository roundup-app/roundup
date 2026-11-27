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
import type { Readback } from "@contracts/agent/Readback";
import { copy as padCopy } from "../pads/copy";

const exec = promisify(execFile);

const SIZE = { wide: 1512, narrow: 388, height: 950 };

const file = (path: string): ChangedFile => ({ path, status: "modified", line: 1, counts: { added: 3, removed: 2 }, blob: null });

const text = (revision: string, body: string) => ({ kind: "text", revision, text: body }) as const;

const body = (tag: string) => Array.from({ length: 30 }, (_, n) => "  const value" + n + " = " + n + (n === 5 || n === 21 ? tag : "") + ";").join("\n") + "\n";

const COMPARISON: FileComparison = { base: "base", oldPath: "", newPath: "", status: "modified", old: text("o", body("")), new: text("n", body(" + 1")) };

const FILES = ["pads/padSave.ts", "pads/padSave.model.py"].map(file);

const CHART = {
  summary: "While a Pad saves, a later edit from outside can hide the user's own edit.",
  writtenBy: "the readback",
  rules: [{ id: "r1", name: "A saved edit stays visible", verdict: "broken" }],
  states: [
    { id: "idle", label: "Idle", values: { Revision: "1" }, breaks: [] },
    { id: "typing", label: "Typing", values: { Revision: "1", Unsaved: "yes" }, breaks: [] },
    { id: "saving", label: "Saving", values: { Revision: "1", Unsaved: "no" }, breaks: [] },
    { id: "saved", label: "Saved", values: { Revision: "2" }, breaks: [] },
    { id: "hidden", label: "Edit hidden", values: { Revision: "3", Unsaved: "no" }, breaks: ["r1"] },
  ],
  start: "idle",
  steps: [
    { from: "idle", to: "typing", label: "you type" },
    { from: "typing", to: "saving", label: "you pause" },
    { from: "saving", to: "saved", label: "the Daemon accepts" },
    { from: "saving", to: "hidden", label: "an outside edit lands" },
    { from: "saved", to: "idle", label: "you stop" },
  ],
  stopped: "The check stopped at the first state that hides an edit.",
};

const READ: Readback = {
  state: "read",
  overview: "Adds a save step that waits for the Daemon before it clears the draft.",
  diagram: "Before\nsave -> clear\nAfter\nsave -> send -> clear\n\n```statechart\n" + JSON.stringify(CHART) + "\n```\n",
  flows: [],
  modules: [],
  unplaced: [],
  ranks: [],
  risks: [],
  explanations: [],
  stops: [],
  gaps: [],
};

const WALK = '.icon-statechart button[aria-label="' + padCopy.statechartWalk + '"]';

// U7709f: `just capture U7709f` writes the readback's chart at its start and at the state that breaks a rule at 1512 by 950, and at its start at 388 wide, dark, over the U26 harness; the design critic judges layout and looks.
it("u7709f_the_readback_chart_is_captured_for_the_critic", async () => {
  const directory = captureDir("U7709f");

  if (!directory) return;

  const server = await appServer();
  const shots: { name: string; checks: Checks }[] = [];
  let session = "";

  const browser = async (...args: string[]) => (await exec(agentBrowserExecutable, ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })).stdout;

  const read = async <T>(expression: string): Promise<T> => {
    // SAFETY: agent-browser wraps these constant DOM expressions in its JSON envelope.
    const result = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };

  const until = (expression: string) => browser("wait", "--fn", expression);

  const serve = () => {
    const groups = [{ repo: "/p/transform-education", branch: "main", base: "main", files: FILES }];

    return read(`(() => {
      const handlers = window.__fake.app.handlers;

      handlers["agent.ownedChanges"] = () => ({ groups: ${JSON.stringify(groups)} });
      handlers["agent.changedFiles"] = () => ({ files: ${JSON.stringify(FILES)} });
      handlers["agent.compareFile"] = ({ path }) => ({ ...${JSON.stringify(COMPARISON)}, oldPath: path, newPath: path });
      handlers["agent.readback"] = () => (${JSON.stringify(READ)});
      handlers["agent.readbackStart"] = () => ({ state: "reading" });
      window.__fake.setStatus("agent-1", "idle", "ready");

      return window.__worktrees.refresh("agent-1").then(() => true);
    })()`);
  };

  const shot = async (state: string, ready: string) => {
    await until(ready);
    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, state + ".png"));

    const checks = await read<Checks>("window.__checks()");

    writeFileSync(join(directory, state + ".checks.json"), JSON.stringify(checks, null, 2));
    shots.push({ name: state, checks });
  };

  const DRAWN = "!!document.querySelector('.icon-statechart .statechart-box') && !!document.querySelector('.readback-figure')";

  const states: { name: string; width: number; run: () => Promise<void> }[] = [
    { name: "start", width: SIZE.wide, run: () => shot("start", DRAWN) },
    {
      name: "broken",
      width: SIZE.wide,
      run: async () => {
        await until(DRAWN);
        await read("document.querySelector(" + JSON.stringify(WALK) + ")?.click() ?? false");
        await shot("broken", "!!document.querySelector('.icon-statechart .statechart-box.is-lit[data-state=\"hidden\"]')");
      },
    },
    {
      name: "narrow",
      width: SIZE.narrow,
      run: async () => {
        // The Rail would fill a window this narrow: collapse it so the pane shows.
        await read("document.querySelector('.rail-toggle')?.click() ?? false");
        await until("document.querySelector('.rail')?.dataset.collapsed === 'true'");
        await shot("narrow", DRAWN);
      },
    },
  ];

  try {
    // Each state is a session of its own: a page that opened the view many times stops answering (#7924).
    for (const state of states) {
      session = "changes-chart-" + process.pid + "-" + state.name;
      await browser("open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0] ?? "").href);
      await browser("set", "media", "dark");
      await browser("set", "viewport", String(state.width), String(SIZE.height));
      await until("!!window.__fake && !!document.querySelector('.changes-icon')");
      await serve();
      await until("!!document.querySelector('.changes-icon')");
      await browser("click", ".changes-icon");
      await until("!!document.querySelector('.changes-view .changes-side [data-row=\"overview\"]')");
      // A script click: at 388 px the header wraps and a pointer click on the segment can miss it.
      await read("document.querySelector('.changes-view .app-segment[aria-label=\"Tree\"]')?.click() ?? false");
      await state.run();
      await browser("close");
    }
  } finally {
    await server.close();
  }

  expect(shots.flatMap((each) => [each.checks.D2, each.checks.D5, each.checks.D6].some((check) => check.status !== "pass") ? [each.name] : [])).toEqual([]);
}, 900_000);
