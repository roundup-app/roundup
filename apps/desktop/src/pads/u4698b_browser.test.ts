import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "../shelf/u371Browser";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

const output = captureDir("U4698b");

const menuOutput = captureDir("U5631");

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


it.each(["plus", "slash"].flatMap(entry => [false, true].map(afterPad => ({ entry, afterPad }))))("u5631_todo_block_menu_excludes_agent_details $entry afterPad=$afterPad", { retry: 0, timeout: 90_000 }, async ({ entry, afterPad }) => {
  await openShelf("tree-40", 288, 320, 1512, "dark");
  await browser("set", "viewport", "1512", "950");
  const name = `todo-${entry}-${afterPad}`;

  if (menuOutput) {
    mkdirSync(menuOutput, { recursive: true });
    await browser("record", "start", join(menuOutput, `${name}.webm`));
    await browser("wait", ".shelf-tabs");
    await browser("set", "media", "dark");
  }

  try {
    const shot = async (stage: string) => {
      if (!menuOutput) return;
      await settle();
      await browser("screenshot", join(menuOutput, `${name}-${stage}.png`));
      writeFileSync(join(menuOutput, `${name}-${stage}.checks.json`), JSON.stringify(await evaluate("window.__checks()")));
    };

    if (afterPad) {
      await browser("click", "#shelf-tab-pads");
      await settle();
      await browser("focus", ".pad-name");
      await browser("press", "Enter");
      await browser("wait", ".drawer .ProseMirror");
      await browser("focus", ".drawer .ProseMirror");
      await browser("press", "Control+End");
      await settle();
      await browser("press", "Enter");
      await settle();
      await browser("keyboard", "type", "/For Agents");
      await browser("wait", ".milkdown-slash-menu[data-show=true] li[data-index]");
      await shot("pad-menu");
      await browser("press", "Escape");
      await settle();
      await browser("click", ".drawer .close");
      await settle();
    }

    const body = "Exact Todo prose — 日本語 café. " + "Keep the existing body and identity. ".repeat(24).trimEnd();
    await evaluate(`(async () => {
      await window.__fake.app.rpc('todo.update', { id: 1, title: ${JSON.stringify("Long Todo title ".repeat(12))}, body: ${JSON.stringify(body)} });
      await window.__fake.app.rpc('todo.assign', { id: 1, owner: null });
      return true;
    })()`);

    if (await evaluate("document.querySelector('#shelf-tab-todos').getAttribute('aria-expanded') !== 'true'")) await browser("click", "#shelf-tab-todos");
    await browser("wait", '[data-shelf-group="unassigned"] [data-part="branch-control"]');

    if (await evaluate("document.querySelector('.todos-tab [data-shelf-group=unassigned]').getAttribute('aria-expanded') === 'false'")) await browser("click", '.todos-tab [data-shelf-group="unassigned"] [data-part="branch-control"]');
    await browser("wait", '[data-todo="1"] .todo-row-button');
    await browser("focus", '[data-todo="1"] .todo-row-button');
    await browser("press", "Enter");
    await browser("wait", ".drawer .ProseMirror");
    await browser("click", ".drawer .ProseMirror");
    await browser("wait", ".todo-detail-body button.word");
    await settle();
    await browser("focus", ".drawer .ProseMirror");
    await settle();
    await evaluate("window.__fake.app.calls.length = 0; true");

    if (entry === "plus") {
      await browser("hover", ".drawer .ProseMirror p:first-child");
      await browser("wait", ".milkdown-block-handle[data-show=true]");
      await browser("click", ".milkdown-block-handle .operation-item:first-child");
    } else {
      await browser("focus", ".drawer .ProseMirror");
      await browser("press", "Control+End");
      await settle();
      await browser("press", "Enter");
      await settle();
      await browser("keyboard", "type", "/For Agents");
    }

    await settle();
    await shot("menu");
    const actions = () => evaluate<string[]>("[...document.querySelectorAll('.milkdown-slash-menu[data-show=true] li[data-index]')].map(item => item.textContent.trim())");
    const offered = await actions();
    const draft = await evaluate<string>("document.querySelector('.drawer .ProseMirror').textContent");
    expect(draft).toBe(body + (entry === "slash" ? "/For Agents" : ""));
    const count = offered.length;
    const selected: (string | null)[] = [];

    if (entry === "plus") expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await browser("press", "ArrowDown");
      await settle();
      selected.push(await evaluate("document.querySelector('.milkdown-slash-menu[data-show=true] [aria-selected=true]')?.textContent.trim() ?? null"));
    }

    const retained = () => evaluate("JSON.parse(localStorage.getItem('roundup:drafts:/Users/you/harness') ?? '{\"drafts\":[]}').drafts.filter(draft => draft.destination.surface === 'todos').map(draft => ({ destination: draft.destination, text: draft.value.text }))");
    const unfinished = await retained();

    if (entry === "slash") expect(unfinished).toEqual([{ destination: { surface: "todos", object: "1", recipient: "body" }, text: body + "\n\n/For Agents" }]);

    await shot("keyboard");
    await browser("press", "Escape");
    await settle();
    expect(await retained()).toEqual(unfinished);
    expect(await evaluate("document.querySelectorAll('.drawer details[data-pad-agents]').length")).toBe(0);
    await shot("dismissed");
    expect(await evaluate("window.__fake.app.calls.filter(call => ['todo.update', 'pad.write'].includes(call.method))")).toEqual([]);
    expect(offered.includes("For Agents")).toBe(false);
    expect(selected.includes("For Agents")).toBe(false);
    expect(selected.includes(null)).toBe(false);

  } finally {
    if (menuOutput) await browser("record", "stop");
  }
});
