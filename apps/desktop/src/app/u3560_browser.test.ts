import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";

const start = async (seed = "tree-40") => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("open", url(`/harness.html?seed=${seed}&renderer=dom`));
  await wait("!!window.__fake && document.querySelectorAll('.rail-row').length > 0");
};

const capture = async (id: string, step: string) => {
  const dir = captureDir(id);

  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await browser("screenshot", join(dir, `${step}.png`));
  writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
};

const field = async (kind: string, initial = "alpha bravo charlie") => {
  await start();

  if (kind === "pad") {
    await read(`window.__fake.app.rpc('pad.write', { name: 'pad-3', text: ${JSON.stringify(initial)} })`);
    await browser("click", '[data-id="payments"] .name');
    await browser("click", "#shelf-tab-pads");
    await wait("[...document.querySelectorAll('.pad-name')].some(row => row.textContent === 'pad-3')");
    await read("[...document.querySelectorAll('.pad-name')].find(row => row.textContent === 'pad-3').click()");
    await wait(`document.querySelector('.ProseMirror[contenteditable=true]')?.textContent === ${JSON.stringify(initial)}`);

    return ".ProseMirror[contenteditable=true]";
  }

  if (kind === "ask") {
    await browser("press", "Meta+/");
    await wait("!!document.querySelector('.ask-bar textarea')");

    return ".ask-bar textarea";
  }

  if (kind === "rename") {
    await browser("dblclick", '[data-id="migrate"] .name');
    await wait("!!document.querySelector('[data-id=migrate] input')");

    return '[data-id="migrate"] input';
  }

  // Native editable surfaces exercise the same App event route without any synthetic insertion.
  await read(`(() => { const field = document.createElement('${kind}'); field.id = 'clipboard-field'; field.style.cssText = 'position:fixed;top:100px;left:500px'; document.body.append(field); })()`);

  return "#clipboard-field";
};

it.each(["pad", "ask", "input", "textarea", "rename"])("u3560c_paste_edits_only_the_focused_field_%s", async kind => {
  const selector = await field(kind);

  if (kind !== "pad") await browser("fill", selector, "alpha bravo charlie");
  else await browser("click", selector);
  await browser("clipboard", "write", "雪 🐈\nbonjour");
  await read(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)});
    field.focus();
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.setSelectionRange(6, 11);
    else { const range = document.createRange(); const text = field.querySelector('p').firstChild; range.setStart(text, 6); range.setEnd(text, 11); getSelection().removeAllRanges(); getSelection().addRange(range); }
    window.__clipboardCallsBefore = window.__fake.app.calls.filter(call => call.method === 'terminal.write' || call.method === 'message.send').length;
  })()`);
  await browser("press", "Control+V");
  const value = () => read<string>(`(() => { const field = document.querySelector(${JSON.stringify(selector)}); return 'value' in field ? field.value : field.innerText.replace(/\\n+/g, '\\n').trim(); })()`);
  const expected = ["input", "rename", "pad"].includes(kind) ? "alpha 雪 🐈 bonjour charlie" : "alpha 雪 🐈\nbonjour charlie";
  await wait(`(() => { const field = document.querySelector(${JSON.stringify(selector)}); return ('value' in field ? field.value : field.innerText).includes('bonjour'); })()`);
  expect(await value()).toBe(expected);

  if (["pad", "ask", "rename"].includes(kind)) await capture("U3560c", `paste-${kind}`);
  await browser("press", "Control+Z");
  await wait(`(() => { const field = document.querySelector(${JSON.stringify(selector)}); return ('value' in field ? field.value : field.textContent) === 'alpha bravo charlie'; })()`);
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'terminal.write' || call.method === 'message.send').length === window.__clipboardCallsBefore")).toBe(true);
}, 60_000);

it.each(["agents-10", "tree-40", "bubbles"])("u3560e_intervention_paste_failure_and_recovery_%s", async seed => {
  await start(seed);
  const agent = seed === "bubbles" ? "runner" : "agent-3";
  const terminal = `t-${agent}`;
  await read(`document.querySelector('.rail-row[data-id="${agent}"]').click()`);
  await wait(`window.__terminals.has('${terminal}') && !!document.querySelector('.pane-screen .xterm-helper-textarea')`);

  if (seed === "bubbles") await browser("find", "role", "button", "click", "--name", "Take control", "--exact");
  await read(`(() => {
    const data = new DataTransfer(); data.setData('text/plain', 'hello 雪\\n');
    document.querySelector('.pane-screen .xterm-helper-textarea').dispatchEvent(new ClipboardEvent('paste', { bubbles:true, cancelable:true, clipboardData:data }));
  })()`);
  await wait("window.__fake.app.calls.some(call => call.method === 'terminal.write')");
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'terminal.write').map(call => call.params.id)")).toEqual([terminal]);
  await capture("U3560e", `${seed}-text`);
  await read(`(() => {
    const data = new DataTransfer(); data.items.add(new File([new Uint8Array([137,80,78,71])], 'screenshot.png', { type:'image/png' }));
    window.__fake.app.saveImageFailure = new Error('Image cache unavailable. Drop a file on the pane.');
    document.querySelector('.pane-screen .xterm-helper-textarea').dispatchEvent(new ClipboardEvent('paste', { bubbles:true, cancelable:true, clipboardData:data }));
  })()`);
  await wait("document.querySelector('.pane-failure')?.textContent.includes('Image cache unavailable')");
  await capture("U3560e", `${seed}-failure`);
  await read(`(() => {
    window.__fake.app.saveImageFailure = null;
    const data = new DataTransfer(); data.items.add(new File([new Uint8Array([137,80,78,71])], 'screenshot.png', { type:'image/png' }));
    document.querySelector('.pane-screen .xterm-helper-textarea').dispatchEvent(new ClipboardEvent('paste', { bubbles:true, cancelable:true, clipboardData:data }));
  })()`);
  await wait("!document.querySelector('.pane-failure [role=alert]') && window.__fake.app.savedImages.length === 1");
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'terminal.write').length")).toBe(2);
  await capture("U3560e", `${seed}-image-recovered`);
}, 60_000);

it.each(["pad", "ask", "input", "textarea", "rename"])("u3560c_copy_preserves_the_source_editor_%s", async kind => {
  const selector = await field(kind, "original 雪 🐈");

  if (kind !== "pad") await browser("fill", selector, "original 雪 🐈");
  else await browser("click", selector);
  await browser("clipboard", "write", "");
  await browser("press", "Control+A");
  await browser("press", "Control+C");
  const selected = await read<string>(`(() => { const field = document.querySelector(${JSON.stringify(selector)}); return 'value' in field ? field.value : field.textContent; })()`);
  expect(selected).toBe("original 雪 🐈");
  await read("(() => { const field = document.createElement('textarea'); field.id='copy-observer'; document.body.append(field); field.focus(); })()");
  await browser("press", "Control+V");
  expect(await read("document.querySelector('#copy-observer').value")).toBe("original 雪 🐈");
}, 60_000);
