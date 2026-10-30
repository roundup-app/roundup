import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "../shelf/u371Browser";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

const output = captureDir("U4698b");

const capture = async (name: string) => {
  if (!output) return;
  await browser("screenshot", join(output, `${name}.png`));
  writeFileSync(join(output, `${name}.checks.json`), JSON.stringify(await evaluate("window.__checks()")));
};

it("u4698b_expand_keeps_the_long_pad_and_all_formats_reachable", { retry: 0, timeout: output ? 240_000 : 90_000 }, async () => {
  await openShelf("tree-40", 288, 320, 1512, "dark");

  await browser("set", "viewport", "1512", "950");

  if (output) {
    mkdirSync(output, { recursive: true });
    await browser("record", "start", join(output, "reading.webm"));
    await browser("wait", ".shelf-tabs");
    await browser("set", "media", "dark");
  }

  for (const [width, height] of [[1512, 950], [1280, 820]]) {
    await browser("set", "viewport", String(width), String(height));
    await settle();
    await capture(`before-editor-${width}`);
  }

  const openTodo = async () => {
    if (await evaluate("document.querySelector('#shelf-tab-todos').getAttribute('aria-expanded') !== 'true'")) {
      await browser("click", "#shelf-tab-todos");
    }

    await browser("wait", '.todos-tab [data-shelf-group="unassigned"] [data-part="branch-control"]');
    await evaluate(`(() => { const group = document.querySelector('.todos-tab [data-shelf-group="unassigned"]'); if (group?.getAttribute('aria-expanded') === 'false') group.querySelector('[data-part="branch-control"]').click(); return true; })()`);
    await browser("wait", ".shelf .todo-row-button");
    await browser("focus", ".shelf .todo-row-button");
    await browser("press", "Enter");
    await browser("wait", ".drawer .todo-detail-title");
    await settle();
  };

  await openTodo();

  for (const [width, height] of [[1512, 950], [1280, 820]]) {
    await browser("set", "viewport", String(width), String(height));
    await settle();
    await capture(`todo-before-editor-${width}`);
  }

  await browser("click", ".drawer .close");
  await settle();

  const name = "Document reading and formatting ".repeat(7).slice(0, 200);
  const table = `| Decision | Owner | Context |\n| --- | --- | --- |\n| ${"LongUnbrokenWord".repeat(12)} | Ada | ${"Table prose wraps across multiple lines. ".repeat(15)} |`;
  const text = `# Plan for the next release\n\nA document with **structure**, *emphasis*, \`code\` and [a useful link](https://example.com).\n\n${table}\n\n## Scope\n\n- First deliverable\n- Second deliverable\n\n### Details\n\n> A readable quote.\n\n#### Deeper heading\n\n##### Further detail\n\n###### Last heading\n\n${Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}. ${"Reading should remain comfortable as the document grows. ".repeat(7)}`).join("\n\n")}`;

  await evaluate(`(async () => {
    await window.__fake.app.rpc('pad.create', ${JSON.stringify({ name, text })});
    document.querySelector('#shelf-tab-pads').click();
    return true;
  })()`);
  await browser("wait", "[data-shelf-group=unassigned]");
  await evaluate(`(() => { const group = document.querySelector('[data-shelf-group=unassigned] [data-part=branch-control]'); if (group?.getAttribute('data-state') === 'closed') group.click(); return true; })()`);
  await browser("wait", ".pad-name");
  await evaluate(`(() => { [...document.querySelectorAll('.pad-name')].find(row => row.textContent === ${JSON.stringify(name)}).focus(); return true; })()`);
  await browser("press", "Enter");
  await browser("wait", ".drawer .ProseMirror");
  await settle();

  if (output) {
    await browser("click", '.drawer [aria-label="Restore"]');
    await settle();
    await browser("click", '.drawer [aria-label="Maximise"]');
    await settle();
    await browser("record", "stop");
  }

  for (const [width, height] of [[1512, 950], [1280, 820]]) {
    await browser("set", "viewport", String(width), String(height));
    await settle();
    expect(await evaluate("document.querySelectorAll('.drawer [aria-label=Restore], .drawer [aria-label=Maximise]').length")).toBe(1);

    await capture(`worst-${width}`);
    await browser("click", '.top-bar-heading-button');
    await settle();
    await capture(`heading-menu-${width}`);
    await browser("click", '.top-bar-heading-button');
    await settle();

    await browser("click", '.drawer [aria-label="Restore"]');
    await settle();
    expect(await evaluate("document.querySelector('.drawer').dataset.maximised")).toBe("false");

    await capture(`minimised-${width}`);

    await browser("click", '.drawer [aria-label="Maximise"]');
    await settle();
    expect(await evaluate("document.querySelector('.pad-head-name').textContent")).toBe(name);
  }

  if (output) {
    await evaluate("document.querySelector('.pad-editor').scrollTop = 650; true");
    await settle();
    await capture("scrolled-1280");
    await browser("focus", ".drawer .ProseMirror");
    await browser("press", "Control+End");
    await evaluate("window.__fake.failNext(-32000, 'The Pad could not be saved'); true");
    await browser("press", "x");
    await browser("wait", ".drawer [data-pad-dismiss]");
    await evaluate("document.querySelector('.pad-editor').scrollTop = 0; true");
    await settle();
    await capture("save-failure-1280");
  }

  await browser("click", ".drawer .close");
  await settle();

  await openTodo();

  for (const [width, height] of [[1512, 950], [1280, 820]]) {
    await browser("set", "viewport", String(width), String(height));
    await settle();
    await capture(`todo-after-editor-${width}`);
  }
});
