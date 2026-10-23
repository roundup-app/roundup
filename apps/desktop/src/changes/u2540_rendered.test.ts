import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";
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
  await click("roundup/agent-1");
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

it("u2773a_changes_browser_reload_restores_exact_work", async () => {
  await open("/src/changes/u2540.html");
  await showDiff();
  await click("Add note");
  await browser("find", "label", "Note", "fill", "  unfinished e\u0301\n🐝 exact  ");
  await browser("find", "label", "End line", "fill", "2");
  await browser("eval", `(() => { const field = document.querySelector('.note-form textarea'); field.setSelectionRange(2, 9, 'backward'); field.dispatchEvent(new Event('select', { bubbles: true })); })()`);
  await open("/src/changes/u2540.html?restore");
  await showDiff();
  await click("Add note");
  await wait("document.activeElement === document.querySelector('.note-form textarea')");
  expect(await browser("eval", `(() => { const field = document.querySelector('.note-form textarea'); return [field.value, field.selectionStart, field.selectionEnd, field.selectionDirection]; })()`)).toEqual(["  unfinished e\u0301\n🐝 exact  ", 2, 9, "backward"]);
  expect(await browser("eval", "[...document.querySelectorAll('.note-form input')].map(field => field.value)")).toEqual(["1", "2"]);
  expect(await browser("eval", "window.__fake.app.calls.filter(call => call.method === 'message.send').length")).toBe(0);
  await capture("recovered-form", "U2773a");
}, 60_000);

it("u2773e_changes_rendered_retention_failure_is_actionable", async () => {
  const { startWorktreeProject } = await import("../testing/realDaemonFixture");
  const { createServedApp } = await import("../testing/realSeam");
  const logs = await mkdtemp(join(tmpdir(), "unfinished-rendered-log-"));
  const real = await startWorktreeProject({ "same.ts": "base source\n" }, { FAKE_CLAUDE_PROMPT_LOG: join(logs, "prompts.jsonl") }, true);
  const press = (name: string) => browser("eval", `[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(name)}).click()`);

  try {
    const app = createServedApp(real.base);
    const node = await app.rpc("agent.spawn", { cwd: real.dir, parent: null, prompt: null, name: "Recovery", order: { kind: "work", ask: "inspect", limits: [] } });
    await writeFile(join(node.worktree!.path, "same.ts"), "exact work\n");
    await browser("open", `${real.base}/harness.html?daemon=1`);
    await wait(`!!document.querySelector('.rail-row[data-id="${node.id}"] .name')`);
    await browser("eval", `document.querySelector('.rail-row[data-id="${node.id}"] .name').click()`);
    await wait("!!document.querySelector('.worktree-control')");
    await press(node.worktree!.branch);
    await wait("!!document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-type=file]')");
    await browser("eval", "document.querySelector('file-tree-container').shadowRoot.querySelector('[data-item-type=file]').click()");
    await press("View diff");
    await wait("!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-column-number]')");
    await capture("real-before-retention-failure", "U2773e");
    await browser("eval", "(() => { const write = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith('roundup:drafts:')) throw new Error('storage refused'); return write.call(this, key, value); }; })()");
    await press("Add note");
    await browser("screenshot", "/tmp/unfinished-changes-before-retention.png");
    await browser("wait", ".note-form textarea");
    await browser("fill", ".note-form textarea", "  retain this exact e\u0301\n🐝  ");
    await wait("!!document.querySelector('.note-batch [role=alert]')");
    expect(await browser("eval", "document.querySelector('.note-form textarea').value")).toBe("  retain this exact e\u0301\n🐝  ");
    await capture("real-retention-failure", "U2773e");
    await browser("screenshot", "/tmp/unfinished-changes-retention.png");
    expect(await app.rpc("message.list", { to: node.id, status: null })).toHaveLength(0);
    await press("Close");
    await wait("!document.querySelector('.worktree-panel')");
    await press("Recover Changes drafts");
    await wait("!!document.querySelector('.note-recovery')");
    expect(await browser("eval", "document.querySelector('.note-recovery').textContent")).toContain("retain this exact");
    await capture("real-recovery-actions", "U2773e");
    await browser("screenshot", "/tmp/unfinished-changes-recovery.png");
    // The densest established seed exposes a retention failure without truncating a note.
    await open("/src/changes/u2540.html?dense&retention");
    await showDiff();
    await wait("!!document.querySelector('.note-batch [role=alert]')");
    expect(await browser("eval", "document.querySelectorAll('[aria-label=\"Notes\"] > li').length")).toBe(100);
    await capture("dense-retention-failure", "U2773e");
  } finally {
    await browser("open", "about:blank");
    await real.stop();
    await rm(logs, { recursive: true, force: true });
  }
}, 120_000);

it("p3557c_failure_lifetime_changes_rendered", async () => {
  await browser("set", "media", "dark");
  await open("/src/changes/u2540.html?dense&submit-failure");
  // SAFETY: the harness exposes runChecks directly as window.__checks.
  const baseline = await browser("eval", "window.__checks()") as Checks;

  const observe = async (name: string) => {
    const checks = await capture(name, "P3557c");

    for (const id of CHECK_IDS) if (baseline[id].status === "pass") expect(checks[id].status, id).toBe("pass");
  };

  await click("roundup/agent-1");
  await wait("!!document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-type=file]')");
  await browser("eval", `(() => {
    window.__fake.app.editorFailure = new Error('Editor refused this file; retry opening it.');
    document.querySelector('file-tree-container').shadowRoot.querySelector('[data-item-type=file]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
  })()`);
  await wait("!!document.querySelector('[role=alert]')");
  await observe("changes-editor-failed");
  await click("Dismiss");
  await wait("!document.querySelector('[role=alert]')");
  await observe("changes-editor-dismissed");
  await browser("eval", "document.querySelector('file-tree-container').shadowRoot.querySelector('[data-item-type=file]').click()");
  await click("View diff");
  await wait("!!document.querySelector('.diff-reader button') && !!document.querySelector('diffs-container')");
  await browser("eval", "[...document.querySelectorAll('button')].find(button => button.textContent === 'Send notes to agent-1').click()");
  await wait("!!document.querySelector('.note-batch [role=alert]')");
  await observe("changes-submit-failed");
  await click("Dismiss");
  await wait("!document.querySelector('.note-batch [role=alert]')");
  await observe("changes-submit-dismissed");
  await browser("eval", "window.__fake.app.handlers['agent.compareFile'] = () => { throw new Error('Comparison unavailable; retry loading this diff.'); }");
  await click("Refresh");
  await wait("!!document.querySelector('.diff-reader > .reserved-line [role=alert]')");
  await observe("changes-comparison-failed");
  await click("Dismiss");
  await wait("!document.querySelector('[role=alert]')");
  await observe("changes-comparison-dismissed");
}, 90_000);
