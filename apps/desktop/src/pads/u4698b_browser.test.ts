import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "../shelf/u371Browser";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

const output = captureDir("U4698b");

it("u4698b_expand_keeps_the_long_pad_and_all_formats_reachable", { retry: 0, timeout: 90_000 }, async () => {
  await openShelf("tree-40", 288, 320, 1512, "dark");

  if (output) {
    mkdirSync(output, { recursive: true });
    await browser("record", "start", join(output, "reading.webm"));
    await browser("wait", ".shelf-tabs");
    await browser("set", "media", "dark");
  }

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

  for (const [width, height] of [[1512, 950], [1280, 820]]) {
    await browser("set", "viewport", String(width), String(height));
    await settle();
    expect(await evaluate("document.querySelectorAll('.drawer [aria-label=Restore], .drawer [aria-label=Maximise]').length")).toBe(1);
    expect(await evaluate("document.querySelectorAll('.milkdown-top-bar .top-bar-item, .milkdown-top-bar .top-bar-heading-button').length")).toBe(11);

    if (output) {
      await browser("screenshot", join(output, `worst-${width}.png`));
      writeFileSync(join(output, `worst-${width}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
    }

    await browser("click", '.drawer [aria-label="Restore"]');
    await settle();
    expect(await evaluate("document.querySelector('.drawer').dataset.maximised")).toBe("false");

    if (output) await browser("screenshot", join(output, `minimised-${width}.png`));

    await browser("click", '.drawer [aria-label="Maximise"]');
    await settle();
    expect(await evaluate("document.querySelector('.pad-head-name').textContent")).toBe(name);
  }

  if (output) {
    await evaluate("document.querySelector('.pad-editor').scrollTop = 650; true");
    await settle();
    await browser("screenshot", join(output, "scrolled-1280.png"));
    await browser("focus", ".drawer .ProseMirror");
    await browser("press", "Control+End");
    await evaluate("window.__fake.failNext(-32000, 'The Pad could not be saved'); true");
    await browser("press", "x");
    await browser("wait", ".drawer [data-pad-dismiss]");
    await evaluate("document.querySelector('.pad-editor').scrollTop = 0; true");
    await settle();
    await browser("screenshot", join(output, "save-failure-1280.png"));
    await browser("record", "stop");
  }
});
