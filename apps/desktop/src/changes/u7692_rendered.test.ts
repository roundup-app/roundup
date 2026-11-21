// oxlint-disable anti-slop/no-new-web-assertions -- the library draws its separator in a shadow root; the fold counts are read from it, never layout or looks (U7692a).
import { agentBrowserExecutable } from "../testing/chromePage";
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
  const { stdout } = await exec(agentBrowserExecutable, ["--session", session, "--json", ...args], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }).catch((error: ExecFileException & { stdout?: string; stderr?: string }) => {
    if (error instanceof Error && "stdout" in error && "stderr" in error) throw new Error(`${error.message}\n${String(error.stdout)}\n${String(error.stderr)}`);

    throw error;
  });

  // SAFETY: agent-browser returns its own JSON envelope in this isolated session.
  const response = JSON.parse(stdout) as { success: boolean; error?: string; data: { result: unknown } };

  if (!response.success) throw new Error(response.error);

  return response.data.result;
};

const wait = (expression: string) => browser("wait", "--fn", expression);

const open = async (path: string) => { await browser("open", new URL(path, server.resolvedUrls.local[0]).href); await wait("!!window.__fake && !!document.querySelector('.changes-icon')"); };

const showDiff = async () => {
  await browser("click", ".changes-icon");
  await wait("!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')");
};

const capture = async (name: string, id = "U7692c") => {
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
  profile = await mkdtemp(join(tmpdir(), "u7692-browser-"));
  session = `u7692-${profile.split("/").at(-1)}`;
  server = await appServer();
  await browser("--profile", profile, "open", new URL("/src/changes/u2540.html?folds", server.resolvedUrls.local[0]).href);
  await browser("set", "viewport", "1512", "950");
}, 90_000);

afterAll(async () => {
  try { await browser("close"); } finally { await server?.close();

 if (profile) await rm(profile, { recursive: true, force: true }); }
});

/** The library's "N unmodified lines" of each fold, by the fold's index, read down the whole file: Pierre draws only the window around the scroll. */
const counts = async () => browser("eval", `(async () => {
  const mount = document.querySelector('.diff-content');
  const found = {};

  for (let top = 0; top <= mount.scrollHeight; top += mount.clientHeight / 2) {
    mount.scrollTop = top;
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50)));

    for (const fold of document.querySelector('diffs-container').shadowRoot.querySelectorAll('[data-separator]')) {
      const text = fold.querySelector('[data-unmodified-lines]')?.textContent;

      if (text) found[fold.dataset.expandIndex] = text;
    }
  }

  mount.scrollTop = 0;

  return found;
})()`);

/** Clicks the count of the fold at `index`, scrolled into the window first. */
const clickCount = (index: number) => browser("eval", `(async () => {
  const mount = document.querySelector('.diff-content');

  for (let top = 0; top <= mount.scrollHeight; top += mount.clientHeight / 2) {
    mount.scrollTop = top;
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50)));
    const count = document.querySelector('diffs-container').shadowRoot.querySelector('[data-separator][data-expand-index="${index}"] [data-unmodified-lines]');

    if (count) return count.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  }

  throw new Error('no fold ${index}');
})()`);

const click = (name: string) => browser("find", "role", "button", "click", "--name", name, "--exact");

const calls = async () => browser("eval", "window.__fake.app.calls.length");

const reads = async () => browser("eval", "window.__fake.app.calls.filter(call => call.method === 'agent.compareFile').length");

const folded = async (expected: Record<string, string>) => { await expect.poll(counts, { timeout: 10_000 }).toEqual(expected); };

const ALL = { "1": "450 unmodified lines", "2": "150 unmodified lines", "3": "3 unmodified lines" };

it("u7692a_a_click_on_the_count_reveals_100_lines_at_each_end_and_a_short_fold_opens_whole", async () => {
  await browser("set", "media", "dark");
  await open("/src/changes/u2540.html?folds");
  await showDiff();
  expect(await counts()).toEqual(ALL);
  const before = await calls();

  await clickCount(1);
  await folded({ ...ALL, "1": "250 unmodified lines" });
  await capture("fold-revealed");
  await clickCount(2);
  await folded({ "1": "250 unmodified lines", "3": ALL["3"] });
  await clickCount(3);
  await folded({ "1": "250 unmodified lines" });
  expect(await calls()).toBe(before);
}, 60_000);

/** The diff holds focus, as Tab from the list leaves it. */
const focusDiff = async () => {
  await browser("eval", "(() => { const mount = document.querySelector('.diff-content'); mount.tabIndex = -1; mount.focus(); })()");
};

it("u7692b_v_reveals_the_nearest_fold_by_the_click_step", async () => {
  await open("/src/changes/u2540.html?folds");
  await showDiff();
  await focusDiff();
  const before = await reads();

  // The focused line is the first change's, line 1: V opens the fold after it, then each further V opens more of it, then the next.
  await browser("press", "v");
  await folded({ ...ALL, "1": "250 unmodified lines" });
  await browser("press", "v");
  await folded({ ...ALL, "1": "50 unmodified lines" });
  await browser("press", "v");
  await folded({ "2": ALL["2"], "3": ALL["3"] });
  await browser("press", "v");
  await folded({ "3": ALL["3"] });
  await browser("press", "v");
  await folded({});
  await browser("press", "v");
  await folded({});
  expect(await reads()).toBe(before);

  // A file with no fold: V does nothing.
  await browser("eval", "(() => { window.__fake.app.handlers['agent.compareFile'] = ({ path }) => ({ base: 'b', oldPath: path, newPath: path, status: 'modified', old: { kind: 'text', revision: 'o', text: 'one\\n' }, new: { kind: 'text', revision: 'n', text: 'two\\n' } }); })()");
  await browser("press", "j");
  await wait("document.querySelector('.diff-path')?.textContent === 'src/file-0.ts'");
  await wait("!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')");
  const small = await reads();

  await focusDiff();
  await browser("press", "v");
  expect(await counts()).toEqual({});
  expect(await reads()).toBe(small);
}, 60_000);

it("u7692a_reveals_stay_across_a_note_and_a_refresh_and_fold_again_on_a_file_switch", async () => {
  await open("/src/changes/u2540.html?folds");
  await showDiff();
  await clickCount(1);
  await folded({ ...ALL, "1": "250 unmodified lines" });
  await click("Add note");
  await browser("find", "label", "Note", "fill", "a note on the first change");
  await click("Save");
  await wait("!!document.querySelector('[aria-label=\"Notes\"]')");
  await browser("eval", "(async () => { await window.__worktrees.refresh('agent-1'); await window.__worktrees.refresh('agent-1'); })()");
  await folded({ ...ALL, "1": "250 unmodified lines" });

  // Another file and back: a fresh reader folds the file again.
  await focusDiff();
  await browser("eval", "(() => { const { handlers } = window.__fake.app; const read = handlers['agent.compareFile']; handlers['agent.compareFile'] = params => params.path === 'src/example.ts' ? read(params) : { base: 'b', oldPath: params.path, newPath: params.path, status: 'modified', old: { kind: 'text', revision: 'o', text: 'one\\n' }, new: { kind: 'text', revision: 'n', text: 'two\\n' } }; })()");
  await browser("press", "j");
  await wait("document.querySelector('.diff-path')?.textContent === 'src/file-0.ts'");
  await focusDiff();
  await browser("press", "k");
  await wait("document.querySelector('.diff-path')?.textContent === 'src/example.ts'");
  await wait("!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-line]')");
  await folded(ALL);
}, 60_000);

it("u7692a_reload_folds_the_file_again", async () => {
  await open("/src/changes/u2540.html?folds");
  await showDiff();
  await clickCount(1);
  await folded({ ...ALL, "1": "250 unmodified lines" });

  // The file's entry takes a new blob: the reader waits for Reload, which reads it again and folds it.
  await browser("eval", `(() => {
    const { handlers } = window.__fake.app;
    const ownedChanges = handlers['agent.ownedChanges'];
    const mark = file => ({ ...file, blob: 'moved-on' });

    handlers['agent.ownedChanges'] = async params => { const answer = await ownedChanges(params); return { groups: answer.groups.map(group => ({ ...group, files: group.files.map(mark) })) }; };
    const compareFile = handlers['agent.compareFile'];

    handlers['agent.compareFile'] = async params => structuredClone(await compareFile(params));
    window.__fake.setStatus('agent-1', 'idle', 'ready');

    return window.__worktrees.refresh('agent-1').then(() => true);
  })()`);
  await wait("!!document.querySelector('.diff-reader [role=status] button')");
  await click("Reload");
  await wait("!document.querySelector('.diff-reader [role=status] button')");
  await folded(ALL);
}, 60_000);
