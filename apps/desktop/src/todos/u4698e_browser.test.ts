import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { it, expect } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "../shelf/u371Browser";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

const output = captureDir("U4698e");

it.each([[1280, 820], [1512, 950]])("u4698e_activity_rendered_%sx%s", { retry: 0, timeout: 180_000 }, async (width, height) => {
  await openShelf("tree-40", 288, 320, width, "dark");
  await browser("set", "viewport", String(width), String(height));
  const directory = output ? join(output, process.env.ACTIVITY_BASE ? "base" : "head") : null;

  if (directory) {
    mkdirSync(directory, { recursive: true });
    await browser("record", "start", join(directory, `activity-${width}.webm`));
    await browser("wait", ".shelf-tabs");
    await browser("set", "media", "dark");
    writeFileSync(join(directory, `metadata-${width}.json`), JSON.stringify({ sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), seed: "tree-40", viewport: [width, height], scheme: "dark", comments: [0, 3, 200], unbroken: 500 }));
  }

  try {
  const capture = async (name: string) => {
    await settle();

    if (!directory) return;
    await browser("screenshot", join(directory, `${name}-${width}.png`));
    writeFileSync(join(directory, `${name}-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
  };

  await evaluate(`(async () => {
    const app = window.__fake.app;
    await app.rpc('todo.update', { id: 1, title: 'Review the release and its deployment dependencies '.repeat(4), body: '# Release plan\\n\\nA document and its Activity share a reading edge.\\n\\n' + 'Review each dependency before publishing. '.repeat(15) });
    const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click();
    return true;
  })()`);
  await browser("wait", "[data-shelf-group=unassigned]");
  await evaluate("(() => { const group = document.querySelector('[data-shelf-group=unassigned] [data-part=branch-control]'); if (group?.getAttribute('data-state') === 'closed') group.click(); return true; })()");
  await browser("wait", '[data-todo="1"] .todo-row-button');
  await browser("focus", '[data-todo="1"] .todo-row-button');
  await browser("press", "Enter");
  await browser("wait", ".todo-comment-field");
  await settle();
  await evaluate("document.querySelector('.todo-comments').scrollIntoView(); true");
  await capture("empty");

  const add = async (from: number, through: number) => {
    await evaluate(`(async () => {
      for (let i = ${from}; i <= ${through}; i++) {
        window.__fake.actAs({ kind: i % 3 === 0 ? 'agent' : 'user', id: i % 3 === 0 ? 'agent-1' : 'you', parent: null });
        await window.__fake.app.rpc('todo.comment', { id: 1, body: i % 3 === 0 ? '::status Verified release ' + i + '\\n  Tests passed.\\n  All dependencies checked.' : i === 2 ? 'DeploymentArtifact'.repeat(32).slice(0, 500) + '\\nA second line with 日本語 and é.' : 'Review comment ' + i });
      }
      window.__fake.actAs({ kind: 'user', id: 'you', parent: null });
      return true;
    })()`);
    await browser("wait", "--fn", `document.querySelectorAll('[data-comment]').length >= ${through > 20 ? 19 : through}`);
  };

  await add(1, 3);
  await capture("three");
  await browser("focus", ".todo-status-summary");
  await settle();
  await browser("press", "Space");
  await browser("wait", '.todo-status-summary[aria-expanded="true"]');
  await capture("agent-open");
  await add(4, 200);
  // Reopen to observe the opening fold rather than evicting live rows.
  await browser("click", ".drawer .close");
  await browser("wait", '.drawer[data-mounted="false"]');
  await browser("focus", '[data-todo="1"] .todo-row-button');
  await browser("press", "Enter");
  await browser("wait", ".todo-comment-field");
  await settle();
  await evaluate("document.querySelector('.todo-comments').scrollIntoView(); true");
  await capture("dense-folded");

  if (await evaluate("!!document.querySelector('.todo-older')")) {
    await browser("click", ".todo-older");
    await browser("wait", '.todo-older[aria-expanded="true"]');
  }

  await capture("dense-exposed");
  await browser("fill", ".todo-comment-field", "Unsent release notes 日本語\n".repeat(10));

  const samples = await evaluate(`(async () => {
    const field = document.querySelector('.todo-comment-field'); field.focus(); const samples = [];
    for (const char of 'abcdefghijklmnopqrst') {
      const start = performance.now(); field.setRangeText(char, field.selectionStart, field.selectionEnd, 'end'); field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); samples.push(performance.now() - start);
    }
    const pane = document.querySelector('.todo-detail'); pane.scrollTop = 0; await new Promise(resolve => requestAnimationFrame(resolve)); pane.scrollTop = pane.scrollHeight;
    return { samples, fullScroll: pane.scrollTop > 0, focusRetained: document.activeElement === field };
  })()`);

  if (directory) writeFileSync(join(directory, `responsiveness-${width}.json`), JSON.stringify(samples, null, 2));
  await capture("draft");
  await evaluate("window.__fake.app.handlers['todo.comment'] = () => { throw new Error('Comment could not be sent. Your exact draft is retained; retry when the connection returns.'); }; window.__fake.app.handlers['todo.readHistory'] = () => { throw new Error('History could not be marked read. Retry history to keep the unread boundary.'); }; true");
  await browser("click", ".drawer .close");
  await browser("wait", '.drawer[data-mounted="false"]');
  await browser("focus", '[data-todo="1"] .todo-row-button');
  await browser("press", "Enter");
  await browser("wait", ".todo-comment-field");
  await settle();

  if (await evaluate("!!document.querySelector('.todo-history-line')")) {
    await browser("click", ".todo-history-line");
    await settle();
  }

  if (await evaluate("!!document.querySelector('.todo-older')")) {
    await browser("click", ".todo-older");
    await browser("wait", '.todo-older[aria-expanded="true"]');
  }

  await browser("focus", ".todo-comment-field");
  await browser("press", "Enter");
  await browser("wait", "--fn", "document.querySelector('.todo-comments')?.textContent.includes('Comment could not be sent')");
  await capture("rejected-send");
  expect(await evaluate("document.querySelector('.todo-comment-field').value.startsWith('Unsent release notes')")).toBe(true);
  } finally { if (directory) await browser("record", "stop"); }
});
