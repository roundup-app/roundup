import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

it("u2572b_a_real_action_choice_reports_creation_failure_without_writing_to_a_Terminal", async () => {
  const captures = captureDir("U2572d");
  const server = await appServer();
  const origin = server.resolvedUrls.local[0]!;

  try {
    const ready = await fetch(new URL("/__roundup_ready", origin));

    if (!ready.ok) throw new Error(await ready.text());

    for (const theme of captures ? ["light", "dark", "contrast"] : ["light"]) {
      const session = `u2572-${process.pid}-${theme}`;
      const profile = mkdtempSync(join(tmpdir(), "u2572-"));
      const browser = async (...args: string[]) => (await exec("agent-browser", ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

      const read = async <T,>(expression: string): Promise<T> => {
        // SAFETY: agent-browser wraps the result of the constant expressions below in this envelope.
        const result = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

        if (!result.success) throw new Error(result.error);

        return result.data.result;
      };

      const capture = async (name: string) => {
        if (!captures) return;

        const directory = join(captures, "head");
        mkdirSync(directory, { recursive: true });
        await browser("screenshot", join(directory, `${theme}-${name}.png`));
        writeFileSync(join(directory, `${theme}-${name}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
      };

      try {
        const args = ["--profile", profile];

        if (theme === "contrast") args.push("--args", "--force-high-contrast");

        await browser(...args, "open", new URL("/harness.html?seed=tree-40", origin).href);
        await browser("set", "viewport", "1512", "950");
        await browser("set", "media", theme === "dark" ? "dark" : "light");
        await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.rail-row')");
        await browser("press", "Meta+k");
        await browser("press", "k");
        await browser("wait", "--fn", "!!document.querySelector('.switcher input')");

        for (const [name, query] of [["empty", ""], ["new", "new"], ["action-only", "New Agent with a prompt"], ["no-match", "zzzz-no-match"]]) {
          await read(`(() => { const f=document.querySelector('.switcher input'); f.value=${JSON.stringify(query)}; f.dispatchEvent(new Event('input',{bubbles:true})); })()`);
          await capture(name!);
        }

        await read("(() => { const f=document.querySelector('.switcher input'); f.value='New Terminal'; f.dispatchEvent(new Event('input',{bubbles:true})); window.__fake.failNext(-32003,'Terminal creation rejected'); window.__before=window.__fake.app.calls.length; })()");
        await browser("press", "Enter");
        await browser("wait", "--fn", "!document.querySelector('.switcher') && [...document.querySelectorAll('[role=alert]')].some(e=>e.textContent.includes('Terminal creation rejected'))");
        const calls = await read<{ method: string; params: unknown }[]>("window.__fake.app.calls.slice(window.__before).filter(c=>['terminal.open','terminal.write'].includes(c.method))");

        // The harness rejects the next call before recording it; another creation attempt or a Terminal write would be recorded.
        expect(calls).toEqual([]);
        await capture("failure");

        const failureCaptures = captureDir("P3557c");

        if (failureCaptures) {
          mkdirSync(failureCaptures, { recursive: true });
          await browser("record", "start", join(failureCaptures, "dismiss.webm"));
          await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.rail-row')");
          await browser("set", "media", "dark");
          await browser("press", "Meta+k");
          await browser("press", "k");
          await browser("wait", "--fn", "!!document.querySelector('.switcher input')");
          await read("(() => { Storage.prototype.setItem=()=>{throw new Error('full')}; Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}}); const f=document.querySelector('.switcher input'); f.value='  é 🧭 東京  '; f.dispatchEvent(new Event('input',{bubbles:true})); f.setSelectionRange(2,9,'backward'); f.dispatchEvent(new Event('keyup',{bubbles:true})); })()");
          await browser("find", "role", "button", "click", "--name", "Copy query", "--exact");
          await browser("wait", "--fn", "[...document.querySelectorAll('.switcher [role=alert]')].some(e=>e.textContent.includes('Could not copy query'))");

          for (const step of ["before", "after"]) {
            if (step === "after") await browser("find", "role", "button", "click", "--name", "Close", "--exact");
            await browser("screenshot", join(failureCaptures, `${step}.png`));
            writeFileSync(join(failureCaptures, `${step}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
          }

          await browser("record", "stop");
        }
      } finally {
        try { await browser("close"); } finally { rmSync(profile, { recursive: true, force: true }); }
      }
    }
  } finally { await server.close(); }
}, 180_000);
