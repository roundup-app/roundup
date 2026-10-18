import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";
import { CHECK_IDS } from "../testing/checks";
import type { Checks } from "../testing/checks";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

let server: AppServer;

let profile: string;

let session: string;

const browser = async (...args: string[]) => {
  const { stdout } = await exec("agent-browser", ["--session", session, "--json", ...args], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  // SAFETY: agent-browser returns its own JSON envelope in this isolated session.
  const response = JSON.parse(stdout) as { success: boolean; error?: string; data: { result: unknown } };

  if (!response.success) throw new Error(response.error);

  return response.data.result;
};

const wait = (expression: string) => browser("wait", "--fn", expression);

const open = async (path: string) => { await browser("open", new URL(path, server.resolvedUrls.local[0]).href); await wait("!!window.__fake && !!document.querySelector('.worktree-control')"); };

const click = (name: string) => browser("find", "role", "button", "click", "--name", name, "--exact");

const showDiff = async () => {
  await click("roundup/agent-1");
  await wait("!!document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-type=file]')");
  await browser("eval", "document.querySelector('file-tree-container').shadowRoot.querySelector('[data-item-type=file]').click()");
  await click("View diff");
};

const capture = async (name: string) => {
  const checks = await browser("eval", "window.__checks()");
  const dir = captureDir("U2540");

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
}, 60_000);

it("u2540d_review_stage_rendered_observer", async () => {
  for (const theme of ["light", "dark"]) {
    await browser("set", "media", theme);
    await open("/src/changes/u2540.html");
    const baseline = await capture(`${theme}-before`);
    await showDiff();
    await wait("!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-column-number]')");
    const after = await capture(`${theme}-diff`);

    for (const id of CHECK_IDS) if (baseline[id].status === "pass") expect(after[id].status, id).toBe("pass");
    await click("Back");
    await wait("!!document.querySelector('file-tree-container')");
    await click("Close");
    await open("/src/changes/u2540.html?dense");
    await showDiff();
    await wait("!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-column-number]')");
    await wait("document.querySelectorAll('[aria-label=\"Notes\"] > li').length === 100");
    const dense = await capture(`${theme}-dense`);

    for (const id of CHECK_IDS) if (baseline[id].status === "pass") expect(dense[id].status, id).toBe("pass");
    await click("Close");
    await open("/src/changes/u2540.html?dense&failure");
    await showDiff();
    await wait("!!document.querySelector('[role=alert]')");
    const failure = await capture(`${theme}-failure`);

    for (const id of CHECK_IDS) if (baseline[id].status === "pass") expect(failure[id].status, id).toBe("pass");
    await click("Back");
    await click("Close");
  }
}, 180_000);
