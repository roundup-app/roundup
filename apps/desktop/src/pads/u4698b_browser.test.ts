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

// Policy observers record visual evidence; assertions stay in the behavioral guards.
const typographyOutputs = [captureDir("U5574a"), captureDir("U5574b")].filter((path): path is string => path !== null);

it.skipIf(typographyOutputs.length === 0)("u5574a_u5574b_observe_pad_scale_and_rhythm", { retry: 0, timeout: 600_000 }, async () => {
  const { readFileSync } = await import("node:fs");
  const fixtures = ["owner", "structure"].map(name => ({ name, text: readFileSync(new URL(`./${name}-sample.md`, import.meta.url), "utf8") }));
  const revision = process.env.ROUNDUP_PAD_BASELINE ? "base" : "head";

  const save = async (name: string) => {
    await settle();
    const readings = await evaluate("window.__checks()");

    for (const output of typographyOutputs) {
      const dir = join(output, revision);
      mkdirSync(dir, { recursive: true });
      await browser("screenshot", join(dir, `${name}.png`));
      writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(readings));
    }
  };

  for (const fixture of fixtures) {
    await openShelf("tree-40", 288, 320, 1512, "dark");
    await evaluate(`(async () => { await window.__fake.app.rpc('pad.create', ${JSON.stringify({ name: fixture.name, text: fixture.text })}); document.querySelector('#shelf-tab-pads').click(); return true; })()`);
    await browser("wait", "[data-shelf-group=unassigned]");
    await evaluate(`(() => { const group = document.querySelector('[data-shelf-group=unassigned] [data-part=branch-control]'); if (group?.getAttribute('data-state') === 'closed') group.click(); return true; })()`);
    await browser("wait", ".pad-name");
    await evaluate(`(() => { [...document.querySelectorAll('.pad-name')].find(row => row.textContent === ${JSON.stringify(fixture.name)}).focus(); return true; })()`);
    await browser("press", "Enter");
    await browser("wait", ".drawer .ProseMirror");
    await settle();

    for (const renderer of ["editor", "readonly"]) {
      if (renderer === "readonly") {
        // Same existing binding as p2544a's read-only observer, no product mode.
        await evaluate(`(async () => {
          const source = await (await fetch('/src/pads/PadRichEditor.tsx')).text();
          const dependencies = source.split('"').filter(path => path.includes('/deps/'));
          const { createComponent } = await import(dependencies.find(path => path.includes('/solid-js.js')));
          const { render } = await import(dependencies.find(path => path.includes('/solid-js_web.js')));
          const { default: PadRichEditor } = await import('/src/pads/PadRichEditor.tsx');
          const original = document.querySelector('.pad-body > .pad-editor');
          original.style.display = 'none';
          const root = document.createElement('div');
          root.style.display = 'contents';
          original.parentElement.append(root);
          window.__disposeReadonly = render(() => createComponent(PadRichEditor, {
            text: ${JSON.stringify(fixture.text)}, readonly: true,
            onChange() {}, onText() {}, onBlur() {}, onReady() {}
          }), root);
        })()`);
        await browser("wait", ".pad-readonly .ProseMirror[contenteditable=false]");
      }

      const surface = renderer === "editor" ? ".pad-body > .pad-editor .ProseMirror" : ".pad-readonly .ProseMirror";

      for (const scheme of ["light", "dark"]) {
        await browser("set", "media", scheme);

        for (const [width, height] of [[1512, 950], [1280, 820]]) {
          await browser("set", "viewport", String(width), String(height));

          for (const expanded of [true, false]) {
            const action = expanded ? "Maximise" : "Restore";

            if (await evaluate(`Boolean(document.querySelector('.drawer [aria-label="${action}"]'))`)) await browser("click", `.drawer [aria-label="${action}"]`);
            await settle();
            const prefix = `${fixture.name}-${renderer}-${scheme}-${width}-${expanded ? "expanded" : "side"}`;
            await evaluate(`document.querySelector(${JSON.stringify(surface)}).closest('.pad-editor').scrollTop = 0; true`);
            await save(`${prefix}-rest`);

            const lines = await evaluate(`(() => {
              const root = document.querySelector(${JSON.stringify(surface)});
              return [...root.querySelectorAll(':scope > p')].slice(0, 3).flatMap(p => {
                const node = p.firstChild;
                if (!node || node.nodeType !== Node.TEXT_NODE) return [];
                const lines = new Map();
                for (let i = 0; i < node.length; i++) {
                  const range = document.createRange(); range.setStart(node, i); range.setEnd(node, i + 1);
                  const y = range.getBoundingClientRect().top;
                  lines.set(y, (lines.get(y) || '') + node.textContent[i]);
                }
                return [...lines.values()].slice(0, -1).map(text => ({text, count: text.length}));
              }).slice(0, 3);
            })()`);

            for (const output of typographyOutputs) writeFileSync(join(output, revision, `${prefix}-lines.json`), JSON.stringify({fixture: fixture.name, renderer, scheme, width, height, expanded, interfaceScale: 1, lines}));
            const headings = await evaluate<number>(`document.querySelector(${JSON.stringify(surface)}).querySelectorAll('h2, h3, h4, h5, h6').length`);

            for (let i = 0; i < headings; i++) {
              await evaluate(`document.querySelector(${JSON.stringify(surface)}).querySelectorAll('h2, h3, h4, h5, h6')[${i}].scrollIntoView({block: 'start'}); true`);
              await save(`${prefix}-section-${i}`);
            }
          }
        }
      }

      if (renderer === "readonly") await evaluate("window.__disposeReadonly(); true");
    }
  }
});
