import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

it("u3787c_switcher_keyboard_entry_selection_and_native_query_in_the_mounted_App", async () => {
  const server = await appServer();
  const origin = server.resolvedUrls.local[0]!;
  const session = `switcher-list-${process.pid}`;
  const profile = mkdtempSync(join(tmpdir(), "switcher-list-"));
  const browser = async (...args: string[]) => { return (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout; };

  const read = async <T,>(expression: string): Promise<T> => {
    // SAFETY: agent-browser's JSON envelope holds the result of these constant DOM expressions.
    const result = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };

  const captures = captureDir("U3787c");

  const capture = async (name: string) => {
    if (!captures) return;
    await browser("screenshot", join(captures, `${name}.png`));
    writeFileSync(join(captures, `${name}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
  };

  try {
    if (captures) mkdirSync(captures, { recursive: true });
    await browser("--profile", profile, "open", new URL("/harness.html?seed=tree-40", origin).href);
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");

    for (const seed of ["tree-40", "tabs-8", "conflict"]) {
      // Seeds share an origin and Project path; begin each mounted observation with fresh drafts.
      await read("localStorage.clear()");
      await browser("open", new URL(`/harness.html?seed=${seed}`, origin).href);
      await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.rail-row')");

      if (captures) {
        await browser("record", "start", join(captures, `${seed}.webm`));
        // Recording creates a fresh page; wait for its production App before opening.
        await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.rail-row')");
      }

      await browser("set", "media", "dark");

      if (seed === "tabs-8") {
        // The tab seed's secondary Daemons replace the fake's primary binding; extend the
        // first Project explicitly so its owned content, including duplicate Unicode names, is dense.
        await read("(() => { const app=window.__fake.app.of('/Users/you/harness'); const base=window.__fake.app.handlers['rail.tree']()[0]; app.handlers['rail.tree']=()=>Array.from({length:8},(_,i)=>({...base,id:'switcher-'+i,name:i<2?'調査 é 🧭':'調査 é 🧭 '+i+' '+ 'Long name '.repeat(4),parent:null,order:i,terminal_id:null})); app.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'}); })()");
        await browser("click", '.project-tab[data-path="/Users/you/harness"] .tab-name-button');
      }

      await browser("press", "Meta+k");
      await browser("press", "k");
      await browser("wait", "--fn", "!!document.querySelector('.switcher input') && document.activeElement === document.querySelector('.switcher input')");
      await browser("fill", ".switcher input", "");
      const before = await read<number>("window.__fake.app.calls.length");
      const ids = await read<string[]>("[...document.querySelectorAll('.switcher [data-collection-value]')].map(e=>e.dataset.value)");
      expect(ids.length).toBeGreaterThanOrEqual(5);
      await capture(`${seed}-before`);
      // Native Tab from the query reaches the content list, not a manufactured focus event.
      await browser("press", "Tab");
      await browser("wait", "--fn", "!!document.activeElement?.dataset.collectionValue");
      await browser("press", "End");
      expect(await read("document.activeElement.dataset.value")).toBe(ids.at(-1));
      await browser("press", "ArrowDown");
      expect(await read("document.activeElement.dataset.value")).toBe(ids.at(-1));
      await browser("press", "Home");
      expect(await read("document.activeElement.dataset.value")).toBe(ids[0]);
      await browser("press", "Meta+a");
      expect(await read("[...document.querySelectorAll('.switcher [aria-selected=true]')].map(e=>e.dataset.value)")).toEqual(ids);
      expect(await read("window.__fake.app.calls.length")).toBe(before);
      await capture(`${seed}-selected`);
      await browser("press", "Shift+Tab");
      await browser("wait", "--fn", "document.activeElement?.matches('.switcher input')");
      await browser("fill", ".switcher input", "  é 🧭 東京  ");
      // The native Linux editor uses Control; the App's content selection above uses Meta.
      await browser("press", process.platform === "darwin" ? "Meta+a" : "Control+a");
      expect(await read("[document.activeElement.selectionStart,document.activeElement.selectionEnd,document.activeElement.value]")).toEqual([0, 12, "  é 🧭 東京  "]);

      await browser("press", "Home");
      expect(await read("[document.activeElement.selectionStart,document.activeElement.selectionEnd]")).toEqual([0, 0]);
      await browser("press", "End");
      expect(await read("[document.activeElement.selectionStart,document.activeElement.selectionEnd]")).toEqual([12, 12]);

      if (seed === "tree-40") {
        await read("(() => { Storage.prototype.setItem=()=>{throw new Error('full')}; const f=document.querySelector('.switcher input'); f.value+='!'; f.dispatchEvent(new Event('input',{bubbles:true})); })()");
        await browser("wait", "--fn", "!!document.querySelector('.switcher [role=alert]')");
        await capture(`${seed}-retention-failure`);
      }

      await browser("press", "Escape");
      await browser("wait", "--fn", "!document.querySelector('.switcher')");

      if (captures) await browser("record", "stop");
    }
  } finally {
    try { await browser("close"); }
    finally { rmSync(profile, { recursive: true, force: true }); await server.close(); }
  }
}, 180_000);
