import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { it, expect } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "../shelf/u371Browser";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

const output = captureDir("U5119");

it.each([[1280, 820], [1512, 950]])("u5119_partial_activity_rendered_%sx%s", { retry: 0, timeout: 180_000 }, async (width, height) => {
  await openShelf("tree-40", 288, 320, width, "dark");
  await browser("set", "viewport", String(width), String(height));
  const directory = output ? join(output, process.env.ACTIVITY_BASE ? "base" : "head") : null;

  if (directory) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `metadata-${width}.json`), JSON.stringify({ sha: process.env.ACTIVITY_BASE || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), seed: "tree-40", viewport: [width, height], scheme: "dark", available: 30, recovered: 15 }));
    await browser("record", "start", join(directory, `retry-${width}.webm`));
  }

  // Recording creates a fresh browser context; reapply the requested scheme.
  await browser("set", "media", "dark");

  const capture = async (name: string) => {
    await settle();

    if (!directory) return;
    await browser("screenshot", join(directory, `${name}-${width}.png`));
    writeFileSync(join(directory, `${name}-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
  };

  try {
    await evaluate("document.querySelector('[data-todo-root]')?.click(); true");
    await settle();
    await browser("wait", "#shelf-tab-todos");
    await evaluate("(() => { const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); return true; })()");
    await browser("wait", "[data-shelf-group=unassigned]");
    await evaluate("(() => { const group = document.querySelector('[data-shelf-group=unassigned] [data-part=branch-control]'); if (group?.getAttribute('data-state') === 'closed') group.click(); return true; })()");
    await browser("wait", '[data-todo="1"] .todo-row-button');

    for (const failed of ["comments", "history"]) {
      for (const expanded of [false, true]) {
        await evaluate(`(() => {
          const app = window.__fake.app;
          const values = { title: 'Release', body: '', done: false, blockers: [], owner: null, priority: null };
          const available = Array.from({length:30}, (_, i) => i + 1);
          const recovered = [...Array.from({length:10}, (_, i) => i - 9), ...[31,32,33,34,35]];
          let recoveredSource = false;
          window.__fake.recoverActivity = () => { recoveredSource = true; };
          app.handlers['todo.comments'] = () => {
            if ('${failed}' === 'comments' && !recoveredSource) { throw new Error('Comments could not load because the connection was lost. Retry to recover comments; your unfinished comment is retained.'); }
            return ('${failed}' === 'comments' ? recovered : available).map(id => ({ id, created_at: 1700000000000 + id * 1000, read: true, author: {kind:'agent', id:'tokens', parent:null}, body: '::status Verified release ' + id + '\\n  Tests passed and dependencies checked.\\n  日本語 release notes remain available.' }));
          };
          app.handlers['todo.getHistory'] = () => {
            if ('${failed}' === 'history' && !recoveredSource) { throw new Error('History could not load because the connection was lost. Retry to recover changes; your unfinished comment is retained.'); }
            return { unread:null, changes: ('${failed}' === 'history' ? recovered : available).map(seq => ({seq, changed_at:1700000000000 + seq * 1000, actor:null, before:values, after:{...values,title:'Release revision ' + seq}})) };
          };
          return true;
        })()`);
        await browser("click", '[data-todo="1"] [aria-label="Open todo 1"]');
        await browser("wait", ".todo-comment-field");
        await browser("wait", ".todo-comments [role=alert]");
        await settle();
        await browser("fill", ".todo-comment-field", "Unsent release notes 日本語\n".repeat(10));
        await settle();

        if (expanded && await evaluate("!!document.querySelector('.todo-older')")) {
          await evaluate("document.querySelector('.todo-older').scrollIntoView({block:'center'}); true");
          await settle();
          await browser("click", ".todo-older");
          await browser("wait", '.todo-older[aria-expanded="true"]');
          await settle();
        }

        if (await evaluate("!!document.querySelector('.todo-status-summary')")) {
          await evaluate("document.querySelector('.todo-status-summary').scrollIntoView({block:'center'}); true");
          await settle();
          await browser("click", ".todo-status-summary");
          await browser("wait", '.todo-status-summary[aria-expanded="true"]');
        }

        await evaluate("document.querySelector('.todo-comments [role=alert]').scrollIntoView({block:'center'}); true");
        await capture(`${failed}-${expanded ? 'open' : 'closed'}-failure`);
        await evaluate("window.__fake.recoverActivity(); true");
        await browser("focus", ".todo-comment-field");
        await evaluate("document.querySelector('.todo-comments [role=alert]').scrollIntoView({block:'center'}); true");
        await settle();
        await browser("find", "role", "button", "click", "--name", failed === "history" ? "Retry history" : "Retry comments");
        await browser("wait", "--fn", "!document.querySelector('.todo-comments [role=alert]')");
        expect(await evaluate("document.activeElement === document.querySelector('.todo-comment-field')")).toBe(true);
        await capture(`${failed}-${expanded ? 'open' : 'closed'}-recovered`);
        await evaluate("document.querySelector('.todo-comment-field').scrollIntoView({block:'center'}); true");
        await capture(`${failed}-${expanded ? 'open' : 'closed'}-draft`);
        expect(await evaluate("document.querySelector('.todo-comment-field').value.startsWith('Unsent release notes')")).toBe(true);
        await browser("click", ".drawer .close");
        await browser("wait", '.drawer[data-mounted="false"]');
      }
    }
  } finally { if (directory) await browser("record", "stop"); }
});
