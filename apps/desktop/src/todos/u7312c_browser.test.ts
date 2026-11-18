import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "../shelf/u371Browser";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

const output = captureDir("U7312c");

// U7312c: each reading block an Agent writes (Q5561), in a Todo's body and in a Pad.
const blocks = [
  "Release is ready; one slow lane remains.",
  "",
  "> [!IMPORTANT]",
  "> Merge after the web lane passes.",
  "",
  "| Lane | Minutes |",
  "|---|---|",
  "| web | 4 |",
  "| rust | 9 |",
  "",
  "```diff",
  "-const timeout = 5;",
  "+const timeout = 10;",
  "```",
  "",
  "```mermaid",
  "xychart-beta",
  "  x-axis [web, rust, lint]",
  "  y-axis \"Minutes\" 0 --> 10",
  "  bar [4, 9, 2]",
  "```",
  "",
  "```mermaid",
  "pie title Lane share",
  "  \"web\" : 4",
  "  \"rust\" : 9",
  "  \"lint\" : 2",
  "```",
  "",
  "<details><summary>For Agents</summary>",
  "",
  "- `just check` ran on the head.",
  "",
  "</details>",
  "",
].join("\n");

// T21: one shown line, then one closed fold.
const comment = "Shipped the fix; **one** lane left.\n\n<details><summary>For Agents</summary>\n\n| Lane | Time |\n|---|---|\n| web | 4 min |\n\n```diff\n-old\n+new\n```\n\n</details>";

const charts = ".drawer svg[aria-roledescription=pie], .drawer svg[aria-roledescription=xychart]";

// Mermaid takes its colours when it draws, so each scheme opens fresh.
it.each(["dark", "light"])("u7312c_reading_blocks_rendered_%s", { retry: 0, timeout: 180_000 }, async (scheme) => {
  await openShelf("tree-40", 288, 320, 1512, scheme);
  await browser("set", "viewport", "1512", "950");

  if (output) mkdirSync(output, { recursive: true });

  const capture = async (name: string) => {
    await settle();

    if (!output) return;
    await browser("screenshot", join(output, `${name}-${scheme}.png`));
    writeFileSync(join(output, `${name}-${scheme}.checks.json`), JSON.stringify(await evaluate("window.__checks()"), null, 2));
  };

  await evaluate(`(async () => {
    const fake = window.__fake;
    await fake.app.rpc('todo.update', { id: 1, title: 'Release the web lane fix', body: ${JSON.stringify(blocks)} });
    fake.actAs({ kind: 'agent', id: 'tokens', parent: null });
    await fake.app.rpc('todo.comment', { id: 1, body: ${JSON.stringify(comment)} });
    fake.actAs({ kind: 'user', id: 'you', parent: null });
    await fake.app.rpc('pad.create', { name: 'Reading blocks', text: ${JSON.stringify(blocks)} });
    const tab = document.querySelector('#shelf-tab-todos'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click();
    return true;
  })()`);
  await browser("wait", "[data-shelf-group=unassigned]");
  await evaluate("(() => { const group = document.querySelector('[data-shelf-group=unassigned] .shelf-group-control'); if (group?.getAttribute('aria-expanded') === 'false') group.click(); return true; })()");
  await browser("wait", '[data-todo="1"] .todo-row-button');
  await browser("focus", '[data-todo="1"] .todo-row-button');
  await browser("press", "Enter");
  await browser("wait", ".todo-comment details");
  await browser("wait", "--fn", `document.querySelectorAll('${charts}').length === 2`);
  // U7312b: a Todo's body draws both charts, as a Pad does.
  expect(await evaluate(`document.querySelectorAll('${charts}').length`)).toBe(2);
  await capture("todo-body");
  await evaluate("document.querySelector('.todo-comments').scrollIntoView(); true");
  await capture("todo-comment");
  await browser("click", ".drawer .close");
  await browser("wait", '.drawer[data-mounted="false"]');

  await evaluate("(() => { const tab = document.querySelector('#shelf-tab-pads'); if (tab.getAttribute('aria-expanded') !== 'true') tab.click(); return true; })()");
  await browser("wait", ".pads-tab [data-shelf-group]");
  await evaluate("(() => { for (const group of document.querySelectorAll('.pads-tab [data-shelf-group] .shelf-group-control')) if (group.closest('[role=treeitem]')?.getAttribute('aria-expanded') === 'false') group.click(); return true; })()");
  await browser("wait", '.pads-tab [data-pad="Reading blocks"] .pad-name');
  await evaluate("(() => { document.querySelector('.pads-tab [data-pad=\"Reading blocks\"] .pad-name').focus(); return true; })()");
  await browser("press", "Enter");
  await browser("wait", "--fn", `document.querySelectorAll('${charts}').length === 2`);
  await capture("pad");
});
