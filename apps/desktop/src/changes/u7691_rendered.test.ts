import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import { agentBrowserExecutable } from "../testing/chromePage";
import { captureDir } from "../testing/captures";
import type { Checks } from "../testing/checks";
import { copy } from "./copy";

const exec = promisify(execFile);

const SIZE = { width: 1512, height: 950 };

const READY =
  "!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')";

const NOTE = ".note-view";

const noteIn = (state: string) =>
  `!!document.querySelector('${NOTE}[data-state="${state}"]')`;

const SEND =
  "(() => { [...document.querySelectorAll('.note-batch button')].find(button => (button.getAttribute('aria-label') ?? '').startsWith('Send notes')).click(); return true; })()";

const REWRITE =
  "(() => { const app = window.__fake.app; const read = app.handlers['agent.ownedChanges']; app.handlers['agent.ownedChanges'] = params => { const answer = read(params); return { groups: answer.groups.map(group => ({ ...group, files: group.files.map(file => ({ ...file, blob: 'rewritten' })) })) }; }; window.__fake.setStatus('agent-1', 'idle', 'ready'); return window.__worktrees.refresh('agent-1').then(() => true); })()";

const BODY = "Every caller of this module moves together";

// U7691e: `just capture U7691e` writes a module note saved, sent and outdated at 1512 by 950, App dark, over the U26 harness; the design critic judges layout and looks.
it("u7691e_the_module_note_is_captured_for_the_critic", async () => {
  const directory = captureDir("U7691e");

  if (!directory) return;

  const server = await appServer();
  const session = `changes-group-notes-${process.pid}`;
  const profile = mkdtempSync(join(tmpdir(), "changes-group-notes-"));

  const browser = async (...args: string[]) =>
    (
      await exec(
        agentBrowserExecutable,
        ["--session", session, "--json", ...args],
        { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 },
      )
    ).stdout;

  const read = async <T>(expression: string): Promise<T> => {
    // SAFETY: agent-browser wraps these constant DOM expressions in its JSON envelope.
    const result = JSON.parse(await browser("eval", expression)) as {
      success: boolean;
      data: { result: T };
      error?: string;
    };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };

  const until = (expression: string) => browser("wait", "--fn", expression);

  const click = (name: string) =>
    browser("find", "role", "button", "click", "--name", name, "--exact");

  const shots: { name: string; checks: Checks }[] = [];

  /** Waits for `ready`, then writes `<name>.png` and its Checks. */
  const shot = async (name: string, ready: string) => {
    await until(ready);
    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, `${name}.png`));

    const checks = await read<Checks>("window.__checks()");

    writeFileSync(
      join(directory, `${name}.checks.json`),
      JSON.stringify(checks, null, 2),
    );
    shots.push({ name, checks });
  };

  /** A fresh page of the harness (`query` after its path), the Changes view open on its first file. */
  const opened = async (query = "") => {
    await browser(
      "open",
      new URL(
        `/src/changes/u2540.html${query}`,
        server.resolvedUrls.local[0] ?? "",
      ).href,
    );
    await until("!!window.__fake && !!document.querySelector('.changes-icon')");
    await browser("click", ".changes-icon");
    // U7679c: the view opens on the Overview and reads no file; this step chooses the first module, as a user does.
    await until(
      "!!document.querySelector('.changes-side [data-row=\"module\"]')",
    );
    await browser("click", '.changes-side [data-row="module"]');
    await until(READY);
  };

  /** U7691e: a module note saved, then sent, then outdated by a rewrite of the module's file, App dark. */
  const states = async () => {
    await browser("set", "media", "dark");
    await opened();
    await click(copy.noteOn.module);
    await until("!!document.querySelector('.note-form')");
    await browser("find", "label", "Note", "fill", BODY);
    await click("Save");
    await until(noteIn("unsent"));
    await browser("mouse", "move", "0", "0");
    await shot("note-module-saved", noteIn("unsent"));
    await read(SEND);
    await until(noteIn("sent"));
    await shot("note-module-sent", noteIn("sent"));
    await read(REWRITE);
    await until(noteIn("outdated"));
    await shot("note-module-outdated", noteIn("outdated"));
  };

  try {
    await browser("--profile", profile, "open", "about:blank");
    await browser("set", "viewport", String(SIZE.width), String(SIZE.height));
    await states();
  } finally {
    try {
      await browser("close");
    } finally {
      rmSync(profile, { recursive: true, force: true });
      await server.close();
    }
  }

  // D2, D5 and D6 hold on every state (U7691e); every capture is written before one fails the run.
  expect(
    shots.flatMap((each) =>
      [each.checks.D2, each.checks.D5, each.checks.D6].some(
        (check) => check.status !== "pass",
      )
        ? [each.name]
        : [],
    ),
  ).toEqual([]);
}, 540_000);
