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
    await browser("set", "media", "light");
    await browser("screenshot", join(output, "code-light.png"));
    writeFileSync(join(output, "code-light.checks.json"), JSON.stringify(await evaluate("window.__checks()")));
    await browser("set", "media", "dark");
  }

  expect(await evaluate("document.querySelector('pre code').textContent.includes('const answer')")).toBe(true);
  await browser("click", ".drawer .close");
  await settle();
  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'pad.write').length")).toBe(0);
});

it("u5562a_insert_each_callout", { retry: 0, timeout: 180000 }, async () => {
  for (const kind of ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"]) {
    await openShelf("tree-40", 288, 320, 1512, "dark");
    await evaluate(`(async () => { await window.__fake.app.rpc('pad.create', {name:'Insert callout',text:'Keep  exact\\n'}); document.querySelector('#shelf-tab-pads').click(); return true; })()`);
    await browser("wait", "[data-shelf-group=unassigned]");
    await evaluate(`(() => { const group = document.querySelector('[data-shelf-group=unassigned] [data-part=branch-control]'); if (group?.getAttribute('data-state') === 'closed') group.click(); return true; })()`);
    await browser("wait", ".pad-name");
    await evaluate(`(() => { [...document.querySelectorAll('.pad-name')].find(row => row.textContent === 'Insert callout').focus(); return true; })()`);
    await browser("press", "Enter");
    await browser("wait", ".ProseMirror[contenteditable=true]");
    await browser("focus", ".ProseMirror");
    await browser("press", "Control+End");
    await browser("press", "Enter");
    await browser("keyboard", "type", `/${kind}`);
    await browser("wait", ".milkdown-slash-menu[data-show=true]");

    if (kind === "TIP" || kind === "WARNING") await browser("press", "Enter");
    else await browser("click", ".milkdown-slash-menu li[data-index]");
    await browser("keyboard", "type", "Inserted body");
    await browser("click", ".drawer .close");
    await settle();
    const writes = await evaluate<{ params: { text: string } }[]>("window.__fake.app.calls.filter(call => call.method === 'pad.write')");
    const final = writes.filter(write => write.params.text.includes("Inserted body"));
    expect(final, JSON.stringify(writes)).toHaveLength(1);
    expect(final[0]!.params.text).toContain(`> [!${kind}]\n> Inserted body`);
    expect(final[0]!.params.text.startsWith("Keep  exact\n")).toBe(true);
  }
});

it("u5562b_selection_colour_and_highlight_in_the_real_editor", { retry: 0, timeout: 90000 }, async () => {
  await openShelf("tree-40", 288, 320, 1512, "dark");
  await browser("set", "viewport", "1512", "950");
  await evaluate(`(async () => { await window.__fake.app.rpc('pad.create', {name:'Selection colours',text:'before **word** after'}); document.querySelector('#shelf-tab-pads').click(); return true; })()`);
  await browser("wait", "[data-shelf-group=unassigned]");
  await evaluate(`(() => { const group = document.querySelector('[data-shelf-group=unassigned] [data-part=branch-control]'); if (group?.getAttribute('data-state') === 'closed') group.click(); return true; })()`);
  await browser("wait", ".pad-name");
  await evaluate(`(() => { [...document.querySelectorAll('.pad-name')].find(row => row.textContent === 'Selection colours').focus(); return true; })()`);
  await browser("press", "Enter");
  await browser("wait", ".ProseMirror[contenteditable=true]");
  await browser("focus", ".drawer .ProseMirror");
  await browser("press", "Control+Home");

  for (let i = 0; i < 7; i++) await browser("press", "ArrowRight");

  for (let i = 0; i < 4; i++) await browser("press", "Shift+ArrowRight");
  expect(await evaluate("window.getSelection().toString()")).toBe("word");

  for (const colour of ["Blue", "Green", "Purple", "Red", "Amber"]) {
    await browser("focus", 'button[aria-label="Text colour"]');
    await browser("press", colour === "Blue" ? "Enter" : "Space");
    await browser("wait", '[role="menu"]');
    const output = colour === "Blue" ? captureDir("U5562b") : null;

    if (output) {
      mkdirSync(output, { recursive: true });

      for (const mode of ["dark", "light"]) {
        await browser("set", "media", mode);
        await browser("screenshot", join(output, `palette-${mode}.png`));
        writeFileSync(join(output, `palette-${mode}.checks.json`), JSON.stringify(await evaluate("window.__checks()")));
      }

      await browser("set", "media", "dark");
    }

    await browser("press", colour[0]!);
    await browser("press", "Enter");
    await browser("wait", `.ProseMirror [data-pad-color="${colour.toLowerCase()}"]`);
    expect(await evaluate("window.getSelection().toString()")).toBe("word");
    expect(await evaluate("document.activeElement.matches('.ProseMirror')")).toBe(true);
  }

  await browser("click", 'button[aria-label="Highlight"]');
  await browser("wait", ".ProseMirror mark");
  expect(await evaluate('document.querySelector(\'button[aria-label="Highlight"]\').getAttribute("aria-pressed")')).toBe("true");
  const paletteOutput = captureDir("U5562b");

  if (paletteOutput) await evaluate(`(() => {
    window.__paletteFrames = [];
    window.__paletteReady = new Promise(resolve => {
      const sample = time => {
        const menu = document.querySelector('.pad-colour-menu');
        if (menu) {
          const style = getComputedStyle(menu);
          const trigger = document.querySelector('button[aria-label="Text colour"]');
          window.__paletteFrames.push({ time, opacity: style.opacity, transform: style.transform, menu: menu.getBoundingClientRect().toJSON(), trigger: trigger.getBoundingClientRect().toJSON() });
          if (style.opacity === '1' && !menu.getAnimations().some(animation => animation.playState === 'running')) { resolve(true); return; }
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    return true;
  })()`);
  await browser("click", 'button[aria-label="Text colour"]');
  await browser("wait", '[role="menu"]');
  expect(await evaluate(`document.querySelector('[role="menuitemradio"][data-value="amber"]').getAttribute("aria-checked")`)).toBe("true");

  if (paletteOutput) {
    await evaluate("window.__paletteReady");
    await browser("screenshot", join(paletteOutput, "palette-pointer.png"));
    writeFileSync(join(paletteOutput, "palette-pointer.checks.json"), JSON.stringify(await evaluate("window.__checks()")));
    writeFileSync(join(paletteOutput, "palette-pointer-frames.json"), JSON.stringify(await evaluate("window.__paletteFrames")));
  }

  await browser("click", '[role="menuitemradio"][data-value="default"]');
  expect(await evaluate("document.querySelector('.ProseMirror [data-pad-color]')")).toBeNull();
  expect(await evaluate("!!document.querySelector('.ProseMirror strong mark')")).toBe(true);
  await browser("click", 'button[aria-label="Highlight"]');
  expect(await evaluate("document.querySelector('.ProseMirror mark')")).toBeNull();
  expect(await evaluate('document.querySelector(\'button[aria-label="Highlight"]\').getAttribute("aria-pressed")')).toBe("false");
  await browser("click", ".drawer .close");
  await settle();
  expect(await evaluate("window.__fake.app.calls.filter(call => call.method === 'pad.write').at(-1).params.text")).toBe("before **word** after");

  const recoveryOutput = captureDir("U5562d");

  if (recoveryOutput) {
    mkdirSync(recoveryOutput, { recursive: true });
    await evaluate(`(() => { [...document.querySelectorAll('.pad-name')].find(row => row.textContent === 'Selection colours').focus(); return true; })()`);
    await browser("press", "Enter");
    await browser("wait", ".ProseMirror[contenteditable=true]");
    await evaluate(`(() => { document.querySelector('.drawer [aria-label="Restore"]')?.click(); return true; })()`);
    await settle();
    await browser("focus", ".ProseMirror");
    await evaluate("window.__fake.failNext(-32000, 'Pad save rejected: disk is full. Free space and retry.'); true");
    await browser("press", "Control+End");
    await browser("keyboard", "type", "Retained review draft");
    await browser("click", ".pad-head-name");
    await browser("wait", "--fn", "document.querySelector('.pad-body [role=alert]')?.textContent.includes('Free space and retry.')");
    await browser("screenshot", join(recoveryOutput, "rejected-save-restored.png"));
    writeFileSync(join(recoveryOutput, "rejected-save-restored.checks.json"), JSON.stringify(await evaluate("window.__checks()")));
  }
});
