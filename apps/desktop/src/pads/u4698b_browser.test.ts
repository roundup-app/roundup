import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "../shelf/u371Browser";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

const phase = process.env.ROUNDUP_CAPTURE_PHASE ?? "head";

const baseline = phase === "base";

const selected = captureDir("U5560a") ?? captureDir("U4698b");

const output = selected ? join(selected, phase) : null;

const ownerSample = readFileSync(join(process.cwd(), "src/pads/owner-sample.md"), "utf8");

const structureSample = readFileSync(join(process.cwd(), "src/pads/structure-sample.md"), "utf8");

const typographyOutputs = [captureDir("U5574a"), captureDir("U5574b")].filter((path): path is string => path !== null);

const capture = async (name: string) => {
  if (!output) return;
  await browser("wait", "--fn", "typeof window.__checks === 'function'");
  await browser("screenshot", join(output, `${name}.png`));
  writeFileSync(join(output, `${name}.checks.json`), JSON.stringify(await evaluate("window.__checks()")));
};

it.skipIf(typographyOutputs.length > 0 || Boolean(captureDir("U5705"))).each([[1512, 950], [1280, 820]])("u4698b_expand_keeps_the_long_pad_and_all_formats_reachable %s", { retry: 0, timeout: output ? 240_000 : 90_000 }, async (viewportWidth, viewportHeight) => {
  const viewports = [[viewportWidth, viewportHeight]];
  await openShelf("tree-40", 288, 320, viewportWidth, "dark");

  await browser("set", "viewport", String(viewportWidth), String(viewportHeight));

  if (output) {
    mkdirSync(output, { recursive: true });
    await settle();
    await capture(`before-editor-${viewportWidth}`);
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

  if (output) {
    await openTodo();
    await capture(`todo-before-editor-${viewportWidth}`);
    await browser("click", ".drawer .close");
    await settle();

    // Recording pins the viewport; finish the setup captures before starting it.
    await browser("record", "start", join(output, `reading-${viewportWidth}.webm`));
    await browser("wait", ".shelf-tabs");
    await browser("set", "media", "dark");
  }

  const name = "Document reading and formatting ".repeat(7).slice(0, 200);
  const table = `| Decision | Owner | Context |\n| --- | --- | --- |\n| ${"x".repeat(500)} | Ada | ${"Table prose wraps across multiple lines. ".repeat(15)} |`;
  const text = `# Plan for the next release\n\nA document with **structure**, *emphasis*, \`code\` and [a useful link](https://example.com).\n\n${table}\n\n## Scope\n\n- First deliverable\n- Second deliverable\n\n### Details\n\n> A readable quote.\n\n#### Deeper heading\n\n##### Further detail\n\n###### Last heading\n\n${Array.from({ length: 200 }, (_, i) => `Paragraph ${i + 1}. ${"Reading should remain comfortable as the document grows. ".repeat(7)}`).join("\n\n")}`; // taste-skill-ignore: Fixed link fixture exercises rich-format preservation; it is not product copy.

  await evaluate(`(async () => {
    await window.__fake.app.rpc('pad.create', ${JSON.stringify({ name, text })});
    document.querySelector('#shelf-tab-pads').click();
    return true;
  })()`);
  await browser("wait", "[data-shelf-group=unassigned]");
  await evaluate(`(() => { const group = document.querySelector('[data-shelf-group=unassigned] [data-part=branch-control]'); if (group?.getAttribute('data-state') === 'closed') group.click(); return true; })()`);
  await browser("wait", ".pad-name");
  await evaluate(`(() => { document.querySelector(${JSON.stringify('.pads-tab [data-pad=' + JSON.stringify(name) + '] .pad-name')}).focus(); return true; })()`);
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

  for (const [width, height] of viewports) {
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

    if (output) {
      await browser("click", '.top-bar-heading-button');
      await settle();
      await capture(`heading-menu-${width}`);
      await browser("click", '.top-bar-heading-button');
      await settle();
    }

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
    await capture(`scrolled-${viewportWidth}`);
    await browser("focus", ".drawer .ProseMirror");
    await browser("press", "Control+End");
    await evaluate("window.__fake.failNext(-32000, 'The Pad could not be saved'); true");
    await browser("press", "x");
    await browser("wait", ".drawer [data-pad-dismiss]");
    await evaluate("document.querySelector('.pad-editor').scrollTop = 0; true");
    await settle();
    await capture(`save-failure-${viewportWidth}`);
    await browser("click", ".drawer [data-pad-dismiss]");
    await evaluate(`(async () => {
      const pad = await window.__fake.app.rpc('pad.read', {name: ${JSON.stringify(name)}});
      window.__fake.actAs({kind:'agent',id:'agent-3',parent:null});
      await window.__fake.app.rpc('pad.write', {name:pad.name,text:pad.text + ${JSON.stringify("\n\nExternal change")},expectedRevision:pad.revision,expectedIncarnation:pad.incarnation});
      window.__fake.actAs({kind:'user',id:'you',parent:null});
      return true;
    })()`);
    await browser("wait", "--fn", "[...document.querySelectorAll('.drawer button')].some(button => button.textContent === 'Keep mine')");
    await capture(`conflict-${viewportWidth}`);
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

  for (const [width, height] of viewports) {
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

// Policy observers record visual evidence; assertions stay in the behavioral guards.

it.skipIf(typographyOutputs.length === 0).each([{ name: "owner", text: ownerSample }, { name: "structure", text: structureSample }])("u5574a_u5574b_observe_pad_scale_and_rhythm: $name", { retry: 0, timeout: 600_000 }, async (fixture) => {
  const revision = process.env.ROUNDUP_PAD_BASELINE ? "base" : "head";

  const save = async (name: string) => {
    await settle();

    const readings = await evaluate("window.__checks()");

    let image: string | undefined;

    for (const output of typographyOutputs) {
      const dir = join(output, revision);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${name}.png`);

      if (image) copyFileSync(image, path);
      else { await browser("screenshot", path); image = path; }

      writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(readings));
    }
  };

  await openShelf("tree-40", 288, 320, 1512, "dark");
  await evaluate(`(async () => { await window.__fake.app.rpc('pad.create', ${JSON.stringify({ name: fixture.name, text: fixture.text })}); document.querySelector('#shelf-tab-pads').click(); return true; })()`);
  await browser("wait", "[data-shelf-group=unassigned]");
  await evaluate(`(() => { const group = document.querySelector('[data-shelf-group=unassigned] [data-part=branch-control]'); if (group?.getAttribute('data-state') === 'closed') group.click(); return true; })()`);
  await browser("wait", ".pad-name");
  await evaluate(`(() => { document.querySelector(${JSON.stringify('.pads-tab [data-pad=' + JSON.stringify(fixture.name) + '] .pad-name')}).focus(); return true; })()`);
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

  expect(await evaluate(`window.__fake.app.rpc("pad.read", {name: ${JSON.stringify(fixture.name)}}).then(pad => pad.text)`)).toBe(fixture.text);
  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'pad.write').length")).toBe(0);
});

it.skipIf(typographyOutputs.length === 0)("u5574b_empty_document_remains_editable_after_rhythm_changes", { retry: 0, timeout: 180_000 }, async () => {
  const revision = process.env.ROUNDUP_PAD_BASELINE ? "base" : "head";
  const dir = join(typographyOutputs[0]!, revision);
  mkdirSync(dir, { recursive: true });
  await browser("record", "start", join(dir, "complete-recovery.webm"));
  await openShelf("tree-40", 288, 320, 1512, "dark");
  await browser("set", "viewport", "1512", "950");
  await settle();
  await evaluate(`(async () => { await window.__fake.app.rpc('pad.create', ${JSON.stringify({ name: "rhythm-probe", text: structureSample })}); document.querySelector('#shelf-tab-pads').click(); return true; })()`);
  await browser("wait", "[data-shelf-group=unassigned]");
  await evaluate(`(() => { const group = document.querySelector('[data-shelf-group=unassigned] [data-part=branch-control]'); if (group?.getAttribute('data-state') === 'closed') group.click(); return true; })()`);
  await browser("wait", ".pad-name");
  await evaluate(`(() => { document.querySelector('.pads-tab [data-pad="rhythm-probe"] .pad-name').focus(); return true; })()`);
  await browser("press", "Enter");
  await browser("wait", ".drawer .ProseMirror h1");

  const save = async (name: string) => {
    await settle();

    for (const output of typographyOutputs) {
      mkdirSync(join(output, revision), { recursive: true });
      await browser("screenshot", join(output, revision, `${name}.png`));
      writeFileSync(join(output, revision, `${name}.checks.json`), JSON.stringify(await evaluate("window.__checks()")));
    }
  };

  for (const selector of [".ProseMirror h1", ".ProseMirror .children p"]) {
    const point = await evaluate<{x: number; y: number}>(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); node.scrollIntoView({block: 'center'}); const r = node.getBoundingClientRect(); return {x:r.x + 20,y:r.y + 10}; })()`);
    await settle();
    await browser("mouse", "move", String(Math.round(point.x)), String(Math.round(point.y)));
    await browser("wait", ".milkdown-block-handle[data-show=true]");
    await save(selector.includes("h1") ? "heading-handle" : "list-handle");
  }

  await evaluate(`(() => {
    const heading = document.querySelector('.ProseMirror h2');
    heading.scrollIntoView({block: 'center'});
    heading.closest('[contenteditable]').focus();
    const range = document.createRange();
    range.selectNodeContents(heading);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  })()`);
  await browser("press", "Backspace");
  await browser("wait", "--fn", "document.querySelector('.ProseMirror h2').textContent === ''");

  for (const scheme of ["light", "dark"]) {
    await browser("set", "media", scheme);
    await save(`empty-heading-${scheme}`);
  }

  await browser("keyboard", "type", "Restored heading");
  await browser("wait", "--fn", "document.querySelector('.ProseMirror h2').textContent === 'Restored heading'");
  await save("restored-heading");

  await evaluate(`(() => {
    const code = document.querySelector('.ProseMirror pre code');
    code.scrollIntoView({block: 'center'});
    code.closest('[contenteditable]').focus();
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  })()`);
  await browser("press", "Backspace");
  await browser("wait", "--fn", "document.querySelector('.ProseMirror pre code').textContent === ''");

  for (const scheme of ["light", "dark"]) {
    await browser("set", "media", scheme);
    await save(`empty-code-${scheme}`);
  }

  await browser("keyboard", "type", "const restored = true;");
  await browser("wait", "--fn", "document.querySelector('.ProseMirror pre code').textContent === 'const restored = true;'");
  await save("restored-code");

  await browser("focus", ".ProseMirror");
  await settle();
  await save("keyboard-focus");
  await evaluate("window.__fake.failNext(-32000, 'Pad save rejected: disk is full. Free space and retry.'); true");
  await browser("press", "Control+End");
  await browser("keyboard", "type", "Retained typography draft");
  await browser("click", ".pad-head-name");
  await browser("wait", "--fn", "document.body.textContent.includes('disk is full')");
  await save("dense-save-failure");
  await browser("click", "[data-pad-dismiss]");
  await settle();
  await evaluate(`(async () => {
    const pad = await window.__fake.app.rpc('pad.read', {name: 'rhythm-probe'});
    await window.__fake.app.rpc('pad.write', {name: pad.name, text: pad.text + ${JSON.stringify("\n\nExternal revision")}, expectedIncarnation: pad.incarnation, expectedRevision: pad.revision});
    return true;
  })()`);
  await browser("wait", "--fn", "[...document.querySelectorAll('.pad-body button')].some(button => button.textContent === 'Keep mine')");
  await save("dense-conflict");
  await browser("click", ".drawer .close");
  await settle();
  await evaluate(`(async () => { await window.__fake.app.rpc('pad.create', {name:'empty-rhythm',text:''}); return true; })()`);
  await browser("wait", "--fn", "[...document.querySelectorAll('.pad-name')].some(row => row.textContent === 'empty-rhythm')");
  await evaluate("document.querySelector('.pads-tab [data-pad=\"empty-rhythm\"] .pad-name').focus(); true");
  await browser("press", "Enter");
  await browser("wait", "--fn", "Boolean(document.querySelector('.ProseMirror p'))");
  await save("empty-document");
  await browser("focus", ".ProseMirror");
  await browser("keyboard", "type", "A new paragraph");
  await browser("click", ".pad-head-name");
  await browser("wait", "--fn", "window.__fake.app.calls.some(call => call.method === 'pad.write' && call.params.name === 'empty-rhythm')");
  expect(await evaluate("window.__fake.app.rpc('pad.read', {name:'empty-rhythm'}).then(pad => pad.text.trim())")).toBe("A new paragraph");
  await save("empty-document-edited");
  await browser("record", "stop");

  for (const output of typographyOutputs.slice(1)) copyFileSync(join(dir, "complete-recovery.webm"), join(output, revision, "complete-recovery.webm"));
});

const todoWidthOutput = captureDir("U5705");

it.skipIf(!todoWidthOutput)("u5705_observe_nonempty_todo_and_pad_reading_columns", { retry: 0, timeout: 240_000 }, async () => {
  const revision = process.env.ROUNDUP_PAD_BASELINE ? "base" : "head";
  const dir = join(todoWidthOutput!, revision);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "metadata.json"), JSON.stringify({
    sha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    seed: "tree-40", viewport: [1512, 950], scheme: "dark", interfaceScale: 1,
    tokens: { todo: "--reading-width", pad: "--pad-reading-width", gutter: "--reading-gutter" },
  }, null, 2));
  const prose = Array.from({ length: 5 }, (_, i) => `Paragraph ${i + 1}. ${"The release review keeps the original context beside the work so everyone can read the outcome and decide what happens next. ".repeat(4)}`).join("\n\n");

  const save = async (name: string) => {
    await settle();
    await browser("screenshot", join(dir, `${name}.png`));
    writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await evaluate("window.__checks()")));

    const widths = await evaluate(`(() => {
      const editor = document.querySelector('.drawer .ProseMirror');
      const ancestors = [];
      for (let node = editor; node && !node.matches('.window'); node = node.parentElement) {
        const style = getComputedStyle(node), rect = node.getBoundingClientRect();
        ancestors.push({class: node.className, width: rect.width, x: rect.x, maxWidth: style.maxWidth, fontSize: style.fontSize, lineHeight: style.lineHeight, paddingInline: style.paddingInline, readingWidth: style.getPropertyValue('--reading-width'), padReadingWidth: style.getPropertyValue('--pad-reading-width'), gutter: style.getPropertyValue('--reading-gutter')});
      }
      const edges = [...document.querySelectorAll('.drawer .todo-detail-title, .drawer .pad-head, .drawer .milkdown-top-bar, .drawer .ProseMirror')].map(node => {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
        return {class: node.className, x: rect.x, width: rect.width, paddingInline: style.paddingInline};
      });
      return {edges, viewport: [innerWidth, innerHeight], focus: document.activeElement?.outerHTML.slice(0, 300), ancestors};
    })()`);

    writeFileSync(join(dir, `${name}-widths.json`), JSON.stringify(widths, null, 2));
  };

  await openShelf("tree-40", 288, 320, 1512, "dark");
  await browser("set", "viewport", "1512", "950");
  await evaluate(`(async () => {
    await window.__fake.app.rpc('todo.update', {id: 1, body: ${JSON.stringify(prose)}});
    await window.__fake.app.rpc('todo.assign', {id: 1, owner: null});
    await window.__fake.app.rpc('pad.create', {name: 'Reading review', text: ${JSON.stringify(prose)}});
    return true;
  })()`);

  const openTodo = async () => {
    if (await evaluate("document.querySelector('#shelf-tab-todos').getAttribute('aria-expanded') !== 'true'")) await browser("click", "#shelf-tab-todos");
    await browser("wait", '.todos-tab [data-shelf-group="unassigned"]');
    await evaluate(`(() => { const group = document.querySelector('.todos-tab [data-shelf-group="unassigned"] [data-part="branch-control"]'); if (group?.getAttribute('data-state') === 'closed') group.click(); return true; })()`);
    await browser("wait", '[data-todo="1"] .todo-row-button');
    await browser("focus", '[data-todo="1"] .todo-row-button');
    await browser("press", "Enter");
    await browser("wait", ".drawer .ProseMirror");
    await settle();

    if (await evaluate("Boolean(document.querySelector('.drawer [aria-label=Maximise]'))")) await browser("click", '.drawer [aria-label="Maximise"]');
    await settle();
    await browser("focus", ".drawer .ProseMirror");
    await browser("wait", ".drawer .ProseMirror:focus");
  };

  await openTodo();
  await save("todo-expanded");
  await browser("click", '.drawer [aria-label="Restore"]');
  await settle();
  await browser("focus", ".drawer .ProseMirror");
  await save("todo-minimised");
  await browser("click", '.drawer [aria-label="Maximise"]');
  await settle();
  await browser("focus", ".drawer .ProseMirror");
  await save("todo-reexpanded");
  await browser("click", ".drawer .close");
  await settle();
  await browser("click", "#shelf-tab-pads");
  await browser("wait", '[data-shelf-group="unassigned"]');
  await evaluate(`(() => { const group = document.querySelector('[data-shelf-group="unassigned"] [data-part="branch-control"]'); if (group?.getAttribute('data-state') === 'closed') group.click(); return true; })()`);
  await browser("wait", ".pad-name");
  await evaluate("document.querySelector('.pads-tab [data-pad=\"Reading review\"] .pad-name').focus(); true");
  await browser("press", "Enter");
  await browser("wait", ".drawer .ProseMirror");
  await settle();
  await browser("focus", ".drawer .ProseMirror");
  await save("pad-expanded");
  await browser("click", '.drawer [aria-label="Restore"]');
  await settle();
  await browser("focus", ".drawer .ProseMirror");
  await save("pad-minimised");
  await browser("click", '.drawer [aria-label="Maximise"]');
  await settle();
  await browser("focus", ".drawer .ProseMirror");
  await evaluate("window.__fake.failNext(-32000, 'Pad save rejected: disk is full. Free space and retry.'); true");
  await browser("press", "Control+End");
  await browser("keyboard", "type", "Retained review draft");
  await browser("click", ".pad-head-name");
  await browser("wait", "--fn", "document.body.textContent.includes('disk is full')");
  await evaluate("document.querySelector('.pad-editor').scrollTop = 0; true");
  await save("pad-save-rejected");
  await browser("click", ".drawer .close");
  await settle();
  await openTodo();
  await save("todo-after-pad");
});

const menuOutput = captureDir("U5631");

describe("U5631 Todo block menus", () => {
  beforeEach(async ({ task }) => {
    await browser("set", "viewport", "1512", "950");

    // Recording retains the previous context; keep a second App from rendering.
    if (menuOutput) {
      await browser("open", "about:blank");
      mkdirSync(menuOutput, { recursive: true });
      await browser("record", "start", join(menuOutput, `${task.name}.webm`));
    }

    await openShelf("tree-40", 288, 320, 1512, "dark");
    await browser("set", "viewport", "1512", "950");
  }, 90_000);

it.each(["plus", "slash"].flatMap(entry => [false, true].map(afterPad => ({ entry, afterPad }))))("u5631_todo_block_menu_excludes_agent_details $entry afterPad=$afterPad", { retry: 0, timeout: 90_000 }, async ({ entry, afterPad }) => {
  const name = `todo-${entry}-${afterPad}`;

  try {
    const shot = async (stage: string) => {
      if (!menuOutput) return;
      await settle();
      await browser("screenshot", join(menuOutput, `${name}-${stage}.png`));
      writeFileSync(join(menuOutput, `${name}-${stage}.checks.json`), JSON.stringify(await evaluate("window.__checks()")));
    };

    if (afterPad) {
      await browser("click", "#shelf-tab-pads");
      await browser("wait", '.pads-tab [data-shelf-group=unassigned] [data-part=branch-control]');

      if (await evaluate("document.querySelector('.pads-tab [data-shelf-group=unassigned]').getAttribute('aria-expanded') === 'false'")) await browser("click", '.pads-tab [data-shelf-group=unassigned] [data-part=branch-control]');
      await browser("wait", ".pad-name");
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

    if (entry === "plus") expect(count).toBeGreaterThan(0);

    const selection = "document.querySelector('.milkdown-slash-menu[data-show=true] [aria-selected=true]')";
    await evaluate("window.__u5631Selected = []; true");

    // Crepe's menu/component.tsx clamps ArrowDown at the last item. PadRichEditor.updateMenu
    // mirrors that selection into aria-selected, which acknowledges each key before the next.
    if (count) await browser("batch", "--bail", ...Array.from({ length: count }, (_, index) => [
      ...(index ? ["press ArrowDown"] : []),
      "wait --fn " + JSON.stringify(`${selection}?.getAttribute('data-index') === '${index}'`),
      "eval " + JSON.stringify(`window.__u5631Selected.push(${selection}.textContent.trim()); true`),
    ]).flat());
    const selected = await evaluate<string[]>("window.__u5631Selected");
    expect(selected).toEqual(offered);

    const retained = () => evaluate("JSON.parse(localStorage.getItem('roundup:drafts:/Users/you/harness') ?? '{\"drafts\":[]}').drafts.filter(draft => draft.destination.surface === 'todos').map(draft => ({ destination: draft.destination, text: draft.value.text }))");
    const unfinished = await retained();

    if (entry === "slash") expect(unfinished).toEqual([{ destination: { surface: "todos", object: "1", recipient: "body" }, text: body + "\n\n/For Agents" }]);

    await browser("press", "Escape");
    await settle();
    expect.soft(await retained()).toEqual(unfinished);
    expect.soft(await evaluate("document.querySelector('.drawer .ProseMirror').textContent")).toBe(draft);
    expect(await evaluate("document.querySelectorAll('.drawer details[data-pad-agents]').length")).toBe(0);
    await shot("dismissed");
    expect(await evaluate("window.__fake.app.calls.filter(call => ['todo.update', 'pad.write'].includes(call.method))")).toEqual([]);
    expect(offered.includes("For Agents")).toBe(false);
    expect(selected.includes("For Agents")).toBe(false);

  } finally {
    if (menuOutput) await browser("record", "stop");
  }
});

});
