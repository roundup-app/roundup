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

const READY = "!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')";

const said = (words: string) => `document.body.textContent.includes(${JSON.stringify(words)})`;

/** The words in the diff, whether Pierre draws them in its shadow root or slots them in. */

const FOCUS_DIFF = "(() => { document.querySelector('.diff-content').focus(); return true; })()";

const SIDEWAYS = "(() => { const view = document.querySelector('.changes-view'); const page = document.scrollingElement; return view.scrollWidth <= view.clientWidth && page.scrollWidth <= page.clientWidth; })()";

// U7676e: `just capture U7676e` writes each state at 1512 by 950, dark, over the U26 harness; the design critic judges layout and looks.
it("u7676e_the_notes_are_captured_for_the_critic", async () => {
  const directory = captureDir("U7676e");

  if (!directory) return;

  const server = await appServer();
  const session = `changes-notes-${process.pid}`;
  const profile = mkdtempSync(join(tmpdir(), "changes-notes-"));
  const browser = async (...args: string[]) => (await exec(agentBrowserExecutable, ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })).stdout;

  const read = async <T,>(expression: string): Promise<T> => {
    // SAFETY: agent-browser wraps these constant DOM expressions in its JSON envelope.
    const result = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };

  const until = (expression: string) => browser("wait", "--fn", expression);

  const click = (name: string) => browser("find", "role", "button", "click", "--name", name, "--exact");

  const shots: { name: string; checks: Checks }[] = [];

  /** Waits for `ready`, then writes `<name>.png` and its Checks. */
  const shot = async (name: string, ready: string) => {
    await until(ready);
    mkdirSync(directory, { recursive: true });
    await browser("screenshot", join(directory, `${name}.png`));

    const checks = await read<Checks>("window.__checks()");

    writeFileSync(join(directory, `${name}.checks.json`), JSON.stringify(checks, null, 2));
    shots.push({ name, checks });
  };

  /** A fresh page of the harness (`query` after its path), the Changes view open on its first file. */
  const opened = async (query = "") => {
    await browser("open", new URL(`/src/changes/u2540.html${query}`, server.resolvedUrls.local[0] ?? "").href);
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

  const write = (text: string) => browser("find", "label", "Note", "fill", text);

  const saved = async (text: string, count: number) => {
    await startNote();
    await write(text);
    await click("Save");
    await until(said(copy.noteCount(count)));
  };

  const send = () => read("(() => { [...document.querySelectorAll('.note-batch button')].find(button => button.getAttribute('aria-label').startsWith('Send notes')).click(); return true; })()");

  try {
    await browser("--profile", profile, "open", "about:blank");
    await browser("set", "media", "dark");
    await browser("set", "viewport", String(SIZE.width), String(SIZE.height));

    await opened();
    await saved("Rename this once the callers agree", 1);
    await shot("note-saved", said(copy.noteCount(1)));
    await read(FOCUS_DIFF);
    await browser("press", "e");
    await shot("note-editing", "!!document.querySelector('.note-form')");

    await opened();
    await saved("Rename this once the callers agree", 1);
    await read("(() => { window.__fake.app.handlers['message.send'] = () => new Promise(() => {}); return true; })()");
    await send();
    await shot("note-sending", said(copy.submittingNotes));

    await opened("?submit-failure");
    await saved("Rename this once the callers agree", 1);
    await send();
    await shot("note-send-failed", `!!document.querySelector(".note-batch [aria-label="${copy.retry}"]")`);

    await opened();
    await saved("First note", 1);
    await saved("Second note", 2);
    await until("Object.keys(localStorage).some(key => key.startsWith('roundup:drafts:') && localStorage.getItem(key).includes('Second note'))");
    await opened("?restore");
    await shot("note-restored", said(copy.notesKept(2)));

    // The dense fixture: 100 notes over a 10,000-line diff, the batch list open; the view never scrolls sideways.
    await opened("?dense");
    await until(said(copy.noteCount(100)));
    await read(`(() => { [...document.querySelectorAll('.note-batch button')].find(button => button.textContent === ${JSON.stringify(copy.noteCount(100))}).click(); return true; })()`);
    await shot("note-dense", "!!document.querySelector('[aria-label=Notes]')");
    // U7676e: the dense view's sideways scroll is evidence for the critic, never an assertion (rule 10).
    writeFileSync(join(directory, "note-dense.sideways.json"), JSON.stringify({ fits: await read<boolean>(SIDEWAYS) }));
  } finally {
    try { await browser("close"); }
    finally { rmSync(profile, { recursive: true, force: true }); await server.close(); }
  }

  // D2, D5 and D6 hold on every state (U7676e); every capture is written before one fails the run.
  expect(shots.flatMap(each => [each.checks.D2, each.checks.D5, each.checks.D6].some(check => check.status !== "pass") ? [each.name] : [])).toEqual([]);
}, 540_000);
