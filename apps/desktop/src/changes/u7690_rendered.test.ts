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

const said = (words: string) =>
  `document.body.textContent.includes(${JSON.stringify(words)})`;

const NOTE = ".note-view";

const noteIn = (state: string) =>
  `!!document.querySelector('${NOTE}[data-state="${state}"]')`;

const FOCUS_DIFF =
  "(() => { document.querySelector('.diff-content').focus(); return true; })()";

const SEND =
  "(() => { [...document.querySelectorAll('.note-batch button')].find(button => button.textContent.startsWith('Send notes')).click(); return true; })()";

const REWRITE =
  "(() => { const app = window.__fake.app; const read = app.handlers['agent.compareFile']; app.handlers['agent.compareFile'] = () => ({ ...read(), new: { kind: 'text', revision: 'rewritten', text: 'const first = 99;\\nconst second = 4;\\n' } }); return window.__worktrees.refresh('agent-1').then(() => true); })()";

const BODY = "Rename this once the callers agree";

const REPLACEMENT = "const first = renamedOnceTheCallersAgree(withAVeryLongArgumentList, andAnotherLongArgument, andYetAnotherArgument);";

// U7690d: `just capture U7690d` writes each state at 1512 by 950, App dark, over the U26 harness; the design critic judges layout and looks.
it("u7690d_the_notes_are_captured_for_the_critic", async () => {
  const directory = captureDir("U7690d");

  if (!directory) return;

  const server = await appServer();
  const session = `changes-note-labels-${process.pid}`;
  const profile = mkdtempSync(join(tmpdir(), "changes-note-labels-"));

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
    await until("!!document.querySelector('.changes-side [data-row=\"module\"]')");
    await browser("click", '.changes-side [data-row="module"]');
    await until(READY);
  };

  /** U7676b: N on the focused diff starts a note at the selection. */
  const startNote = async () => {
    await read(FOCUS_DIFF);
    await browser("press", "n");
    await until("!!document.querySelector('.note-form')");
  };

  const write = (text: string) =>
    browser("find", "label", "Note", "fill", text);

  /** Sends the batch, rewrites the opened file so its notes read Outdated, adds an unsent note, and opens the list. */
  const sentAndOutdated = async () => {
    await read(SEND);
    await until(noteIn("sent"));
    await startNote();
    await write(BODY);
    await click("Save");
    await until("!document.querySelector('.note-form')");
    await read(REWRITE);
    await until(noteIn("outdated"));
    await read(FOCUS_DIFF);
    await browser("press", "g");
  };

  /** U7690d: each label, a replacement in the composer and saved, and the jump list, App dark. */
  const states = async () => {
    await browser("set", "media", "dark");

    for (const label of ["Question", "Nit", "Issue"]) {
      await opened();
      await startNote();
      await write(BODY);
      await click(label);
      await browser("mouse", "move", "0", "0");
      await shot(`note-label-${label.toLowerCase()}`, "!!document.querySelector('.note-label [aria-pressed=\"true\"]')");
      await click("Save");
      await until(said(copy.noteCount(1)));
      await shot(`note-saved-${label.toLowerCase()}`, noteIn("unsent"));
    }

    await opened();
    await startNote();
    await write(BODY);
    await click("Suggest a change");
    await browser("find", "label", "Replacement", "fill", REPLACEMENT);
    await shot("note-replacement-composer", "!!document.querySelector('.note-form .note-field textarea')?.value");
    await click("Save");
    await until("!!document.querySelector('.note-replacement')");
    await shot("note-replacement-saved", "!!document.querySelector('.note-replacement')");

    await opened("?spread");
    await until(said(copy.noteCount(3)));
    await sentAndOutdated();
    await shot("note-list", "!!document.querySelector('.note-jump [role=option]')");

    await opened("?worst=100");
    await until(said(copy.noteCount(100)));
    await sentAndOutdated();
    await shot("note-list-worst", "!!document.querySelector('.note-jump [role=option]')");
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

  // D2, D5 and D6 hold on every state (U7690d); every capture is written before one fails the run.
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
