import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { browser, read, url, wait } from "../ui/tabsBrowser";

it.skipIf(!captureDir("U3480"))("u3480_rendered_context_menu_under_dialog", async () => {
  const root = captureDir("U3480");

  if (!root) throw new Error("U3480 capture directory missing");
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");

  for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
    const dir = join(root, base ? "base" : "head");
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: base ? process.env.U500_BASE_ROOT : process.cwd() }).trim();

    const capture = async (step: string) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "revision.json"), JSON.stringify({ sha }, null, 2));
      await browser("screenshot", join(dir, `${step}.png`));
      writeFileSync(join(dir, `${step}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
    };

    await browser("open", url("/harness.html?seed=tree-40&renderer=dom", base));
    await wait("!!window.__fake && !!document.querySelector('.rail-row')");
    await read("localStorage.clear()");
    await read(`document.querySelector('.rail-row[data-id="agent-3"]').click()`);
    await wait("window.__terminals.has('t-agent-3') && !!document.querySelector('.xterm')");
    await read(`window.__fake.writeOutput('t-agent-3', '\\x1b[2J\\x1b[H\\x1b]133;A\\x07$ inspect\\r\\n\\x1b]133;B\\x07original selection\\r\\n\\x1b]133;D;0\\x07')`);
    await wait("window.__terminals.get('t-agent-3').turns().length > 0");
    await read("window.__terminals.get('t-agent-3').selectTurn(0, false)");
    await wait("!!document.querySelector('.send-to-agent-note')");
    const selection = await read<string>("window.__terminals.get('t-agent-3').selection()");

    expect(selection).toContain("original selection");
    // Failure text remains visible on the densest seed throughout the modal sequence.
    await read(`(() => {
      window.__copies = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => window.__copies.push(text), readText: async () => '' } });
      document.querySelector('.pane-screen').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 800, clientY: 300 }));
    })()`);
    await wait("!!document.querySelector('[role=menu]') && document.activeElement === document.querySelector('[role=menu]')");
    await capture("context-open");
    // Programmatic activation opens the real App's modal without an outside pointer press.
    await read("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', code: 'KeyT', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }))");
    await wait("!!document.querySelector('[role=dialog]') && document.querySelector('[role=dialog]').contains(document.activeElement) && !document.querySelector('[role=menu]')");
    await capture("dialog");
    expect(await read("window.__copies")).toEqual([]);
    await browser("press", "Escape");
    await wait("!document.querySelector('[role=dialog]')");
    expect(await read("!!document.querySelector('[role=menu]')")).toBe(false);
    await capture("closed");
    await read(`document.querySelector('.pane-screen').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 800, clientY: 300 }))`);
    await wait("!!document.querySelector('[role=menu]') && document.activeElement === document.querySelector('[role=menu]')");
    await capture("reopened");
    await browser("find", "role", "menuitem", "click", "--name", "Copy", "--exact");
    await wait("window.__copies.length === 1 && !document.querySelector('[role=menu]')");
    expect(await read("window.__copies")).toEqual([selection]);
  }
}, 180_000);
