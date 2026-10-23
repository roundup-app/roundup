import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";
import type { Checks } from "../testing/checks";

const exec = promisify(execFile);

// Rendered acceptance evidence runs only when requested, never as another browser regression suite.
it.skipIf(!captureDir("U3295b"))("u3295b_rendered_modal_dismissal_and_dialog_picker", async () => {
  const server = await appServer({ root: process.env.ROUNDUP_CAPTURE_ROOT ?? process.cwd() });
  const revision = process.env.ROUNDUP_CAPTURE_REVISION ?? (await exec("git", ["rev-parse", "HEAD"])).stdout.trim();
  const profile = mkdtempSync(join(tmpdir(), "u3295-"));
  const session = `u3295-${process.pid}`;
  const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })).stdout;

  const read = async <T,>(expression: string): Promise<T> => {
    // SAFETY: agent-browser returns this documented envelope for our constant expressions.
    const result = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };

  const wait = (expression: string) => browser("wait", "--fn", expression);
  const key = (value: string, code: string, meta = false) => read(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(value)}, code: ${JSON.stringify(code)}, metaKey: ${meta}, bubbles: true, cancelable: true }))`);

  const snap = async (step: string) => {
    for (const id of ["U3295a", "U3295b"]) {
      const dir = join(captureDir(id)!, process.env.ROUNDUP_CAPTURE_PHASE ?? "head");

      mkdirSync(dir, { recursive: true });
      await browser("screenshot", join(dir, `${step}.png`));
      writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify({ revision, ...await read<Checks>("window.__checks()") }, null, 2));
    }
  };

  try {
    await browser("--profile", profile, "open", new URL("/harness.html?seed=tree-40", server.resolvedUrls.local[0]!).href);
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await wait("!!window.__fake && !!document.querySelector('.rail-row')");
    await snap("tree-before");
    await key("/", "Slash", true);
    await wait("!!document.querySelector('.ask-bar[data-mode=over] textarea')");
    await read("(() => { const field = document.querySelector('.ask-bar textarea'); field.value = '@'; field.dispatchEvent(new InputEvent('input', { bubbles: true })); })()");
    await wait("!!document.querySelector('.app-mentions')");
    await browser("click", ".ask-bar textarea");
    expect(await read<boolean>("!!document.querySelector('.app-mentions')")).toBe(true);
    await snap("ask-and-mentions");
    await read("document.querySelector('.rail-import').click()");
    await wait("!!document.querySelector('.import-panel')");
    await snap("import-over-ask");
    await read("[...document.querySelectorAll('.import-panel button')].find(b => b.textContent.trim() === 'Cancel').click()");
    await wait("!document.querySelector('.import-panel')");

    if (!(await read<boolean>("!!document.querySelector('.ask-bar[data-mode=over]')"))) await key("/", "Slash", true);
    await wait("!!document.querySelector('.ask-bar[data-mode=over] textarea')");
    expect(await read<string>("document.querySelector('.ask-bar textarea').value")).toBe("@");
    await snap("ask-reopened");
    await key("Escape", "Escape");
    await key("Escape", "Escape");

    // The recorded dense Shelf supplies the real owner menu and New Workstream Dialog.
    await read("document.querySelector('[data-todo-root]').click(); if(document.querySelector('#shelf-tab-todos')?.getAttribute('aria-expanded') !== 'true') document.querySelector('#shelf-tab-todos')?.click()");
    await wait("!!document.querySelector('.shelf')");
    await read("(() => { for (const b of document.querySelectorAll('[data-shelf-group] [data-part=branch-control]')) if (b.closest('[role=treeitem]')?.getAttribute('aria-expanded') === 'false') b.click(); })()");
    await wait("[...document.querySelectorAll('.todo-row-button')].some(row => row.checkVisibility())");
    await read("(() => { const row = [...document.querySelectorAll('.todo-row-button')].find(row => row.checkVisibility()); row.focus(); row.dispatchEvent(new KeyboardEvent('keydown', {key:'o',code:'KeyO',bubbles:true,cancelable:true})); })()");
    await wait("!!document.querySelector('[role=menu]')");
    await read("[...document.querySelectorAll('[role=menuitem]')].find(b => b.textContent.includes('New Workstream')).click()");
    await wait("!!document.querySelector('.new-workstream')");
    await read("[...document.querySelectorAll('.new-workstream label')].find(l => l.textContent.includes('Start after another Todo')).click()");
    await wait("!!document.querySelector('.app-dialog-pick')");
    await read("document.querySelector('.app-dialog-pick').click()");
    await wait("!!document.querySelector('.todo-blocker-menu [role=combobox]')");
    await snap("dialog-owned-todo-picker");

    if (process.env.ROUNDUP_CAPTURE_PHASE === "base") await read("document.querySelector('.app-dialog-pick').click()");
    else await key("Escape", "Escape");
    await wait("!document.querySelector('.todo-blocker-menu [role=combobox]')");
    await read("window.__fake.failNext(-32003, 'Todo changed. Choose it again and retry.'); document.querySelector('.new-workstream textarea').value = 'Ship the fix'; document.querySelector('.new-workstream textarea').dispatchEvent(new InputEvent('input', {bubbles:true}));");
    await read("[...document.querySelectorAll('.new-workstream label')].find(l => l.textContent.includes('Start now')).click()");
    await read("document.querySelector('.new-workstream form').requestSubmit()");
    await wait("document.querySelector('.new-workstream')?.textContent.includes('Todo changed.')");
    await snap("dense-failure");

    await browser("open", new URL("/harness.html?seed=agents-10", server.resolvedUrls.local[0]!).href);
    await wait("!!window.__fake && !!document.querySelector('.rail-import')");
    await snap("agents-before");
    await read("(() => { const nodes = window.__fake.app.handlers['rail.tree'](); for (const node of nodes.filter(n => n.kind === 'agent' && n.status?.kind !== 'needs-you').slice(0, 3)) window.__fake.setStatus(node.id, 'needs-you', 'Choose the next step'); })()");
    await wait("document.querySelectorAll('.app-toast').length >= 3");
    await snap("toast-stack");
    await read("document.querySelector('.rail-import').click()");
    await wait("!!document.querySelector('.import-panel')");
    await snap("agents-import");
  } finally {
    try { await browser("close"); } finally { await server.close(); rmSync(profile, { recursive: true, force: true }); }
  }
}, 180_000);
