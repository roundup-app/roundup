import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "../shelf/u371Browser";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

it("u5562c_code_colours_render", { retry: 0, timeout: 90000 }, async () => {
  await openShelf("tree-40", 288, 320, 1512, "dark");
  await browser("set", "viewport", "1512", "950");
  const source = '# Code colours\n\n```ts\nconst answer: number = 42; // keeper\nconst label = "Hello";\n```\n';
  await evaluate(`(async () => {
    await window.__fake.app.rpc('pad.create', ${JSON.stringify({ name: "Code colours", text: source })});
    document.querySelector('#shelf-tab-pads').click();
    return true;
  })()`);
  await browser("wait", "[data-shelf-group=unassigned]");
  await evaluate(`(() => { const group = document.querySelector('[data-shelf-group=unassigned] [data-part=branch-control]'); if (group?.getAttribute('data-state') === 'closed') group.click(); return true; })()`);
  await browser("wait", ".pad-name");
  await evaluate(`(() => { [...document.querySelectorAll('.pad-name')].find(row => row.textContent === 'Code colours').focus(); return true; })()`);
  await browser("press", "Enter");
  await browser("wait", ".drawer .pad-syntax-keyword");
  await settle();
  const output = captureDir("U5562c");

  if (output) {
    mkdirSync(output, { recursive: true });
    await browser("screenshot", join(output, "code.png"));
    writeFileSync(join(output, "code.checks.json"), JSON.stringify(await evaluate("window.__checks()")));
  }

  expect(await evaluate("document.querySelector('pre code').textContent.includes('const answer')")).toBe(true);
});
