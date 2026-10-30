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

it.each(["agents-10", "tree-40", "bubbles"])("u3560e_intervention_paste_failure_and_recovery_%s", async seed => {
  await start(seed);
  const agent = seed === "bubbles" ? "runner" : "agent-3";
  const terminal = `t-${agent}`;
  await read(`document.querySelector('.rail-row[data-id="${agent}"]').click()`);
  await wait(`window.__terminals.has('${terminal}') && !!document.querySelector('.pane-screen .xterm-helper-textarea')`);

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
