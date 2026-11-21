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

/** The words in the diff, whether Pierre draws them in its shadow root or slots them in. */
const diffSaid = (words: string) =>
  `(() => { const diff = document.querySelector('diffs-container'); return !!diff && (diff.textContent + (diff.shadowRoot?.textContent ?? '')).includes(${JSON.stringify(words)}); })()`;

const NOTE = ".note-view";

const noteIn = (state: string) =>
  `!!document.querySelector('${NOTE}[data-state="${state}"]')`;

const FOCUS_DIFF =
  "(() => { document.querySelector('.diff-content').focus(); return true; })()";

// U7677f: the first line's text before and after a rewrite: a Sent note whose line changed reads Outdated (U7677e).
const REWRITE =
  "(() => { const app = window.__fake.app; const read = app.handlers['agent.compareFile']; app.handlers['agent.compareFile'] = () => ({ ...read(), new: { kind: 'text', revision: 'rewritten', text: 'const first = 99;\\nconst second = 4;\\n' } }); return window.__worktrees.refresh('agent-1').then(() => true); })()";

const BODY = "Rename this once the callers agree";

// U7677f: `just capture U7677f` writes each state at 1512 by 950, App dark then light, over the U26 harness; the design critic judges layout and looks.
it("u7677f_the_notes_are_captured_for_the_critic", async () => {
  const directory = captureDir("U7677f");

  if (!directory) return;

  const server = await appServer();
  const session = `changes-note-design-${process.pid}`;
  const profile = mkdtempSync(join(tmpdir(), "changes-note-design-"));

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

  const saved = async (text: string, count: number) => {
    await startNote();
    await write(text);
    await click("Save");
    await until(said(copy.noteCount(count)));
  };

  const send = () =>
    read(
      "(() => { [...document.querySelectorAll('.note-batch button')].find(button => button.textContent.startsWith('Send notes')).click(); return true; })()",
    );

  /** Every state of one note in the App's colour scheme (U7677f). */
  const states = async (scheme: "dark" | "light") => {
    const name = (state: string) => `note-${state}-${scheme}`;

    await browser("set", "media", scheme);

    await opened();
    await startNote();
    await write(BODY);
    await shot(
      name("draft"),
      "!!document.querySelector('.note-form textarea')?.value",
    );

    await opened();
    await saved(BODY, 1);
    await browser("mouse", "move", "0", "0");
    await shot(name("saved"), noteIn("unsent"));
    await browser("hover", NOTE);
    await shot(
      name("saved-hovered"),
      `!!document.querySelector('${NOTE}:hover')`,
    );
    await read(FOCUS_DIFF);
    await browser("press", "e");
    await shot(name("editing"), "!!document.querySelector('.note-form')");

    await opened();
    await saved(BODY, 1);
    await read(
      "(() => { window.__fake.app.handlers['message.send'] = () => new Promise(() => {}); return true; })()",
    );
    await send();
    await shot(name("sending"), noteIn("sending"));

    await opened();
    await saved(BODY, 1);
    await send();
    await shot(name("sent"), noteIn("sent"));
    await read(REWRITE);
    await shot(name("outdated"), noteIn("outdated"));

    await opened("?submit-failure");
    await saved(BODY, 1);
    await send();
    await shot(name("send-failed"), said(copy.retry));

    // The worst case: 50 notes on one file, one of 2,000 characters.
    await opened("?worst");
    await until(said(copy.noteCount(50)));
    await shot(name("worst"), diffSaid("Note 2:"));
  };

  try {
    await browser("--profile", profile, "open", "about:blank");
    await browser("set", "viewport", String(SIZE.width), String(SIZE.height));
    await states("dark");
    await states("light");
  } finally {
    try {
      await browser("close");
    } finally {
      rmSync(profile, { recursive: true, force: true });
      await server.close();
    }
  }

  // D2, D5 and D6 hold on every state (U7677f); every capture is written before one fails the run.
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
