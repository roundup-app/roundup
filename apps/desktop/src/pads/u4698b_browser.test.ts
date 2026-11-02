import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "../shelf/u371Browser";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

const phase = process.env.ROUNDUP_CAPTURE_PHASE ?? "head";

const baseline = phase === "base";

const selected = captureDir("U5560a") ?? captureDir("U4698b");

const output = selected ? join(selected, phase) : null;

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
    await browser("wait", "--fn", `innerWidth === ${width} && innerHeight === ${height}`);
    await settle();
    await capture(`before-editor-${width}`);
  }

  const openTodo = async () => {
    if (await evaluate("!document.querySelector('#shelf-tab-todos')")) {
      await browser("press", "Meta+k");
      await browser("press", "b");
      await browser("wait", "#shelf-tab-todos");
      await settle();
    }

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
    await browser("wait", "--fn", `innerWidth === ${width} && innerHeight === ${height}`);
    await settle();
    await capture(`todo-before-editor-${width}`);
  }

  await browser("click", ".drawer .close");
  await settle();

  const name = "Document reading and formatting ".repeat(7).slice(0, 200);
  const table = `| Decision | Owner | Context |\n| --- | --- | --- |\n| ${"x".repeat(500)} | Ada | ${"Table prose wraps across multiple lines. ".repeat(15)} |`;
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
  }

  if (captureDir("U5560a")) {
    await browser("click", "#shelf-tab-pads");
    await settle();
  }

  for (const [width, height] of [[1512, 950], [1280, 820]]) {
    await browser("set", "viewport", String(width), String(height));
    await browser("wait", "--fn", `innerWidth === ${width} && innerHeight === ${height}`);
    await settle();
    expect(await evaluate("document.querySelectorAll('.drawer [aria-label=Restore], .drawer [aria-label=Maximise]').length")).toBe(1);

    if (captureDir("U5560a")) {
      for (const choice of ["Narrow", "Wide", "Full"]) {
        if (!baseline) await browser("click", `.pad-width-control input[value="${choice.toLowerCase()}"]`);
        await settle();
        await capture(`${choice.toLowerCase()}-${width}`);

        if (!baseline) await browser("focus", `.pad-width-control input[value="${choice.toLowerCase()}"]`);
        await capture(`${choice.toLowerCase()}-focus-${width}`);
        await evaluate("document.querySelector('.pad-editor').scrollTop = 650; true");
        await settle();
        await capture(`${choice.toLowerCase()}-scrolled-${width}`);
        await evaluate("document.querySelector('.pad-editor').scrollTop = 0; true");
        await settle();
      }
    }

    if (captureDir("U5560a") && !baseline) {
      await browser("focus", ".top-bar-heading-button");

      for (let step = 0; step < 18 && !(await evaluate("!!document.activeElement.closest('.pad-width-control')")); step++) await browser("press", "Tab");
      expect(await evaluate("!!document.activeElement.closest('.pad-width-control')")).toBe(true);

      for (const choice of ["narrow", "wide", "full"]) {
        await browser("press", "ArrowRight");
        await browser("wait", "--fn", `document.querySelector('.pad-width-control input[value="${choice}"]').checked`);
      }

      await capture(`keyboard-${width}`);
    }

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
    await browser("click", ".drawer [data-pad-dismiss]");
    await evaluate(`(async () => {
      const pad = await window.__fake.app.rpc('pad.read', {name: ${JSON.stringify(name)}});
      window.__fake.actAs({kind:'agent',id:'agent-3',parent:null});
      await window.__fake.app.rpc('pad.write', {name:pad.name,text:pad.text + ${JSON.stringify("\n\nExternal change")},expectedRevision:pad.revision,expectedIncarnation:pad.incarnation});
      window.__fake.actAs({kind:'user',id:'you',parent:null});
      return true;
    })()`);
    await browser("wait", "--fn", "[...document.querySelectorAll('.drawer button')].some(button => button.textContent === 'Keep mine')");
    await capture("conflict-1280");
  }

  await browser("click", ".drawer .close");
  await settle();

  if (captureDir("U5560a") && !baseline) {
    await evaluate("window.dispatchEvent(new Event('open-app-settings')); true");
    await browser("click", '[role=tab][data-value="Pads"]');
    await browser("wait", "--fn", "!!document.querySelector('.settings-content input[value=\"full\"]')");
    await browser("click", '.settings-content input[value="full"]');
    await browser("wait", "--fn", "JSON.parse(localStorage.getItem('roundup:app-settings')).padWidth === 'full'");
    await browser("click", ".settings-back");
  }

  if (output) await browser("record", "stop");

  await openTodo();

  for (const [width, height] of [[1512, 950], [1280, 820]]) {
    await browser("set", "viewport", String(width), String(height));

    await browser("wait", "--fn", `innerWidth === ${width} && innerHeight === ${height}`);
    await settle();
    await capture(`todo-after-editor-${width}`);
    expect(await evaluate("document.querySelectorAll('.pad-width-control [role=radiogroup]').length")).toBe(0);
    await browser("click", '.drawer [aria-label="Restore"]');
    await settle();
    await capture(`todo-collapsed-${width}`);
    await browser("click", '.drawer [aria-label="Maximise"]');
    await settle();

  }
});
