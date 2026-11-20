import { executable } from "../todos/laneBrowser";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { appServer } from "../testing/appServer";
import { captureDir } from "../testing/captures";

const exec = promisify(execFile);

// U7707e: `just capture U7707e` writes the group's states, dark, 1512 by 950, on the densest seed; the design critic judges them.
it("u7707e_the_group_states_are_captured_for_the_critic", async () => {
  const directory = captureDir("U7707e");

  if (!directory) return;

  const server = await appServer();
  const session = `switcher-found-${process.pid}`;
  const profile = mkdtempSync(join(tmpdir(), "switcher-found-"));
  const browser = async (...args: string[]) => (await exec(executable, ["--session", session, "--json", ...args], { maxBuffer: 8 * 1024 * 1024, timeout: 25_000 })).stdout;

  const read = async <T,>(expression: string): Promise<T> => {
    // SAFETY: agent-browser wraps these constant DOM expressions in its JSON envelope.
    const result = JSON.parse(await browser("eval", expression)) as { success: boolean; data: { result: T }; error?: string };

    if (!result.success) throw new Error(result.error);

    return result.data.result;
  };

  const answer = (body: string) => read(`(window.__fake.app.handlers['search.find'] = ${body}, true)`);

  const hits = (count: number) => `Array.from({length:${count}},(_, i)=>({kind:['message','pad','todo'][i%3],id:String(i+1),title:['Renew the token','Notes on renewal','Renew staging'][i%3],snippet:'please renew the token before friday, then renew staging',ranges:[{start:7,end:12},{start:41,end:46}],opens:i%3===0?'migrate':null}))`;

  mkdirSync(directory, { recursive: true });

  const shot = async (name: string, ready: string) => {
    await browser("wait", "--fn", ready);
    await browser("screenshot", join(directory, `${name}.png`));
    writeFileSync(join(directory, `${name}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
  };

  const query = async (text: string) => {
    await browser("fill", ".switcher input", text);
    await browser("wait", "--fn", `document.querySelector('.switcher input').value===${JSON.stringify(text)}`);
  };

  try {
    await browser("--profile", profile, "open", new URL("/harness.html?seed=agents-10", server.resolvedUrls.local[0] ?? "").href);
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.rail-row')");
    await browser("press", "Meta+k");
    await browser("press", "k");
    await browser("wait", "--fn", "document.activeElement?.matches('.switcher input')");

    const options = "document.querySelectorAll('.switcher [data-value^=\"found:\"]').length";

    await answer(`() => ({ hits: ${hits(4)}, more: false })`);
    await query("renew");
    await shot("results", `${options} === 4 && !!document.querySelector('.switcher mark')`);
    expect(await read<number>("document.querySelectorAll('.switcher mark').length")).toBeGreaterThan(0);

    await answer(`() => ({ hits: ${hits(20)}, more: true })`);
    await query("renew t");
    await shot("capped", `${options} === 20`);

    await answer("() => ({ hits: [], more: false })");
    await query("zzqx");
    await shot("none", `${options} === 0 && !!document.querySelector('.switcher')`);

    await answer("() => new Promise(() => {})");
    await query("renew s");
    await shot("searching", "/Searching/.test(document.querySelector('.switcher').textContent)");

    await answer("() => { throw new Error('The Daemon refused the search'); }");
    await query("renew f");
    await shot("failed", "/refused the search/.test(document.querySelector('.switcher').textContent)");
  } finally {
    try { await browser("close"); }
    finally { rmSync(profile, { recursive: true, force: true }); await server.close(); }
  }
}, 120_000);
