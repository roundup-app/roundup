import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";

const capture = async (id: string, name: string) => {
  const out = captureDir(id);

  if (!out) return;
  mkdirSync(out, { recursive: true });
  await browser("screenshot", join(out, `${name}.png`));
  writeFileSync(join(out, `${name}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
};

it.each(["agents-10", "tree-40", "bubbles"])("u5552d_u5552e_rendered_focus_and_clipboard_feedback %s", async seed => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("open", url(`/harness.html?seed=${seed}&renderer=dom`));
  await wait("!!window.__fake && !!document.querySelector('.rail-row')");
  const row = seed === "agents-10" ? "agent-4" : seed === "tree-40" ? "payments" : "runner";
  await browser("click", `.rail-row[data-id="${row}"]`);
  await wait("!!document.querySelector('.pane-screen textarea')");
  await browser("click", ".pane-screen .xterm-screen");
  await wait("document.activeElement.matches('.xterm-helper-textarea')");
  await read(`(() => {
    window.__fake.app.calls.length = 0;
    const data = new DataTransfer(); data.setData('text/plain', 'focus observer 界');
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  })()`);
  await wait("window.__fake.app.calls.some(call => call.method === 'terminal.write')");
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'terminal.write').length")).toBe(1);
  await capture("U5552d", `${seed}-text-focus`);
  await read(`(() => {
    const data = new DataTransfer(); data.items.add(new File([new Uint8Array([137,80,78,71])], 'image.png', {type:'image/png'}));
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  })()`);
  await wait("window.__fake.app.calls.filter(call => call.method === 'terminal.write').length === 2");
  await capture("U5552d", `${seed}-image-focus`);
  await read(`(() => {
    const body = document.querySelector('.pane-body'); const box = body.getBoundingClientRect();
    window.__fake.app.dropFiles({ phase:'drop', paths:['/tmp/focus image.png'], x:box.left+box.width/2,y:box.top+box.height/2 });
  })()`);
  await wait("window.__fake.app.calls.filter(call => call.method === 'terminal.write').length === 3");
  expect(await read("document.activeElement.matches('.xterm-helper-textarea')")).toBe(true);
  await capture("U5552e", `${seed}-drop-focus`);
  await read(`(() => {
    const data = new DataTransfer(); data.items.add(new File(['unsupported'], 'image.bmp', {type:'image/bmp'}));
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  })()`);
  await wait("!!document.querySelector('.pane [role=alert]')");
  await capture("U5552d", `${seed}-clipboard-failure`);
}, 60_000);
