import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";
import type { Checks } from "../testing/checks";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

let server: AppServer;

let profile: string;

let session: string;

const browser = async (...args: string[]) => {
  const { stdout } = await exec("agent-browser", ["--session", session, "--json", ...args], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }).catch((error: ExecFileException & { stdout?: string; stderr?: string }) => {
    if (error instanceof Error && "stdout" in error && "stderr" in error) throw new Error(`${error.message}\n${String(error.stdout)}\n${String(error.stderr)}`);

    throw error;
  });

  // SAFETY: agent-browser returns its own JSON envelope in this isolated session.
  const response = JSON.parse(stdout) as { success: boolean; error?: string; data: { result: unknown } };

  if (!response.success) throw new Error(response.error);

  return response.data.result;
};

const wait = (expression: string) => browser("wait", "--fn", expression);

const open = async (path: string) => { await browser("open", new URL(path, server.resolvedUrls.local[0]).href); await wait("!!window.__fake && !!document.querySelector('.worktree-control')"); };

const click = (name: string) => browser("find", "role", "button", "click", "--name", name, "--exact");

const showDiff = async () => {
  await browser("click", ".worktree-control");
  await wait("!!document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-type=file]')");
  await browser("eval", "document.querySelector('file-tree-container').shadowRoot.querySelector('[data-item-type=file]').click()");
  await click("View diff");
};

const capture = async (name: string, id = "U2540") => {
  const checks = await browser("eval", "window.__checks()");
  const dir = captureDir(id);

  if (dir) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${name}.checks.json`), JSON.stringify(checks, null, 2));
    await browser("screenshot", join(dir, `${name}.png`));
  }

  console.log(name, JSON.stringify(checks));

  // SAFETY: this expression calls the harness's typed observer directly.
  return checks as Checks;
};

beforeAll(async () => {
  profile = await mkdtemp(join(tmpdir(), "u2540-browser-"));
  session = `u2540-${profile.split("/").at(-1)}`;
  server = await appServer();
  await browser("--profile", profile, "open", new URL("/src/changes/u2540.html", server.resolvedUrls.local[0]).href);
  await browser("set", "viewport", "1512", "950");
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close();

 if (profile) await rm(profile, { recursive: true, force: true }); }
});

it("u2540b_pointer_and_keyboard_select_lines", async () => {
  await open("/src/changes/u2540.html");
  await showDiff();
  await wait("!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-column-number]')");
  await browser("eval", `(() => {
    const root = document.querySelector('diffs-container').shadowRoot;
    const numbers = [...root.querySelectorAll('[data-line-type="change-addition"][data-column-number]')];
    numbers[0].dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    numbers[1].dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, shiftKey: true }));
  })()`);
  await wait("document.querySelector('.diff-reader').textContent.includes('New file, lines 1–2')");
  await click("Add note");
  await browser("find", "label", "Note", "fill", "pointer note");
  await click("Save");
  await wait("!!document.querySelector('[aria-label=\"Notes\"]')");
  expect(await browser("eval", "document.querySelector('[aria-label=\"Notes\"]').textContent")).toContain("pointer note");
  await browser("eval", `(() => {
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Add note').focus();
  })()`);
  await browser("press", "Enter");
  await wait("!!document.querySelector('[aria-label=\"Line note\"]')");
  await browser("find", "role", "tab", "click", "--name", "Old", "--exact");
  await wait("document.querySelector('.note-form [role=tab][aria-selected=true]')?.textContent === 'Old'");
  await browser("find", "label", "Start line", "fill", "1");
  await browser("find", "label", "End line", "fill", "2");
  await browser("find", "label", "Note", "fill", "keyboard range");
  await click("Save");
  await wait("document.querySelector('[aria-label=\"Notes\"]').textContent.includes('keyboard range')");
  expect(await browser("eval", "[...document.querySelectorAll('[aria-label=\"Notes\"] > li')].at(-1).textContent")).toContain("Old file, lines 1–2");
  await capture("pointer-and-keyboard-notes");

  const recoveryCapture = captureDir("U2773e");

  if (recoveryCapture) {
    await mkdir(recoveryCapture, { recursive: true });
    await browser("record", "start", join(recoveryCapture, "dense-retention-recovery.webm"));
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");

    for (const state of ["dense", "dense&retention"]) {
      await open(`/src/changes/u2540.html?${state}`);
      await showDiff();
      await wait("document.querySelectorAll('[aria-label=Notes] > li').length === 100");

      if (state.includes("retention")) await wait("!!document.querySelector('.note-batch [role=alert]')");
      await capture(state.includes("retention") ? "dense-retention-failed" : "dense-before-failure", "U2773e");
    }

    await click("Review recovery options");
    await wait("!!document.querySelector('.note-recovery [role=alert]') && !!document.querySelector('.note-recovery .diff-actions')");
    await capture("dense-recovery-actions", "U2773e");
    await browser("record", "stop");
  }
}, 60_000);
