import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromePath, openPage } from "../testing/chromePage";
import type { ChromePage } from "../testing/chromePage";
import { browser, read, wait } from "../ui/tabsBrowser";
import { startRealDaemon } from "../testing/realDaemonFixture";
import type { StartedDaemon } from "../testing/realDaemonFixture";

const found = chromePath();

const run = found || process.env["CI"] ? describe : describe.skip;

let real: StartedDaemon;

let page: ChromePage;

run("u59 on the real Daemon", () => {
  beforeAll(async () => {
    if (!found) throw new Error("U59 needs a Chrome binary: set CHROME_PATH");

    real = await startRealDaemon({}, true);
    page = await openPage(found);
  }, 300_000);

  afterAll(async () => {
    await page?.close();
    await real?.stop();
  });

  vi.setConfig({ testTimeout: 120_000 });

  it.runIf(process.env["U2680_REAL"] === "1")("u2680a_u2680b_real_zsh_webgl_selection_observer", async () => {
    const selectionDaemon = await startRealDaemon({ SHELL: "/bin/zsh", ZDOTDIR: real.dir, HOME: real.dir, skip_global_compinit: "1" }, true);

    const read = <T,>(expression: string) => page.call<T>(`() => (${expression})`);
    const until = (expression: string) => page.until(`() => (${expression})`);

    const point = (selector: string) => page.call<{ x: number; y: number }>(`selector => {
      const box = document.querySelector(selector).getBoundingClientRect();

      return { x: Math.round(box.left + 2), y: Math.round(box.top + box.height / 2) };
    }`, selector);

    const click = async (selector: string) => {
      const at = await point(selector);

      await page.click(at.x, at.y);
    };

    const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      await page.pointer("move", from.x, from.y);
      await page.pointer("down", from.x, from.y);

      for (let step = 1; step <= 5; step++) await page.pointer("move", from.x + (to.x - from.x) * step / 5, from.y + (to.y - from.y) * step / 5);
      await page.pointer("up", to.x, to.y);
    };

    try {
      await page.load(`${selectionDaemon.base}/harness.html?view=workstreams&items=1&tabs=1&daemon=1`, 1512, 950);
      await until("!!document.querySelector('.terminal-new')");
      await click(".terminal-new");
      await until("!!document.querySelector('.bubble:not([hidden]) .xterm-screen canvas')");
      await page.call("() => { window.__emu = [...window.__terminals.values()][0]; }");
      await page.call("() => document.querySelector('.bubble:not([hidden]) .xterm-helper-textarea').focus()");

      for (const key of "printf 'alpha bravo charlie delta echo foxtrot %.0s' {1..1000}") await page.press(key, key);
      await page.press("Enter", "Enter");
      await until(`(async () => {
        const id = document.querySelector('.bubble:not([hidden])').dataset.bubble;
        const response = await fetch('/__daemon/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'terminal.snapshot', params: { id } }) });
        const reply = await response.json();
        return reply.result && atob(reply.result.data).split('alpha bravo charlie delta echo foxtrot').length > 10;
      })()`);
      const screen = ".bubble:not([hidden]) .xterm-screen";
      const at = await point(screen);
      const from = { x: at.x + 20, y: await read<number>("Math.round(document.querySelector('.bubble:not([hidden]) .xterm-screen').getBoundingClientRect().top + 8)") };

      await drag(from, { x: from.x + 100, y: from.y });
      expect(await read<string>("window.__emu.selection()")).not.toBe("");
      expect(await read<boolean>("getSelection().isCollapsed")).toBe(true);
      await click(".bubble-header");
      expect(await read<string>("window.__emu.selection()")).toBe("");
      await page.doubleClick(from.x + 20, from.y);
      expect(await read<string>("window.__emu.selection()")).not.toBe("");
      await click(".window-title");
      expect(await read<string>("window.__emu.selection()")).toBe("");
    } finally {
      await selectionDaemon.stop();
    }
  }, 180_000);
});

// U4590's real-Daemon policy observation, opt-in alongside the rendered capture matrix.
it.runIf(process.env.ROUNDUP_CAPTURES?.split(',').includes('U4590'))("u4590_restored_terminal_keeps_its_program_and_paints_later_output", async () => {
  const { mkdtemp, readFile, writeFile, mkdir, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { captureDir } = await import("../testing/captures");
  const scratch = await mkdtemp(join(tmpdir(), "u4590-restore-"));
  const source = await readFile(join(process.cwd(), "../../crates/agents/tests/scenarios/spawn.rs"), "utf8");
  const program = source.split('const SIZE_PROGRAM: &str = r#"exec python3 -c \'')[1]!.split("'\"#;")[0]!;
  const executable = join(scratch, "size-program");
  await writeFile(executable, "#!/usr/bin/env python3\n" + program, { mode: 0o755 });
  const real = await startRealDaemon({ SHELL: executable }, true);
  const app = createServedApp(real.base);
  const dir = join(captureDir("U4590")!, process.env.U4590_EVIDENCE_SIDE === "base" ? "base" : "head");
  await mkdir(dir, { recursive: true });

  try {
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await browser("open", `${real.base}/harness.html?daemon=1&view=workstreams&items=1&tabs=1&renderer=dom`);
    await wait("!!document.querySelector('.terminal-new')");
    await browser("click", ".terminal-new");
    await wait("!!document.querySelector('.bubble:not([hidden]) .xterm-rows')");
    const id = await read<string>("document.querySelector('.bubble:not([hidden])').dataset.bubble");
    await wait(`document.querySelector('.bubble:not([hidden]) .xterm-rows').textContent.includes('pid=') && window.__terminals.has('${id}')`);
    const before = await app.rpc("terminal.snapshot", { id });
    const pid = /pid=(\d+)/.exec(Buffer.from(before.data, "base64").toString())![1];
    const incarnation = (await app.rpc("terminal.list", null)).find(t => t.id === id)!.incarnation;
    // Reload reconstructs the App and uses the normal subscription/snapshot restoration path.
    await browser("reload");
    await wait(`window.__terminals?.has('${id}') && !!document.querySelector('.bubble:not([hidden]) .xterm-rows')`);
    await wait(`document.querySelector('.bubble:not([hidden]) .xterm-rows').textContent.includes('pid=${pid}')`);
    await read(`window.__restored = window.__terminals.get('${id}'); window.__host = document.querySelector('.bubble:not([hidden]) .bubble-body')`);
    await browser("dblclick", ".bubble:not([hidden]) .bubble-header");
    await wait(`(() => { const emulator = window.__terminals.get('${id}'); const rows = document.querySelector('.bubble:not([hidden]) .xterm-rows'); return emulator.serialize().data.includes('later ') && rows.textContent.includes('later ') && rows.textContent.includes('pid=${pid}'); })()`);
    let snapshot = before;
    await expect.poll(async () => { snapshot = await app.rpc("terminal.snapshot", { id });

 return { cols: snapshot.cols, rows: snapshot.rows }; }).not.toEqual({ cols: before.cols, rows: before.rows });
    const fitted = await read<{ cols: number; rows: number }>(`(() => { const s = window.__terminals.get('${id}').serialize(); return {cols:s.cols,rows:s.rows}; })()`);
    expect(fitted).toEqual({ cols: snapshot.cols, rows: snapshot.rows });
    expect((await app.rpc("terminal.list", null)).find(t => t.id === id)!.incarnation).toBe(incarnation);
    expect(Buffer.from(snapshot.data, "base64").toString()).toContain(`pid=${pid}`);
    expect(await read(`window.__restored === window.__terminals.get('${id}') && window.__host === document.querySelector('.bubble:not([hidden]) .bubble-body')`)).toBe(true);
    await wait(`window.__host.querySelector('.xterm-rows').textContent.includes('later ${snapshot.cols} ${snapshot.rows} pid=${pid}') && window.__restored.serialize().data.includes('later ${snapshot.cols} ${snapshot.rows} pid=${pid}')`);
    const record = await read(`({visibleRows:window.__host.querySelector('.xterm-rows').textContent, snapshot:window.__restored.serialize()})`);
    const { execFileSync } = await import("node:child_process");
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {encoding:"utf8"}).trim();
    await writeFile(join(dir, "real-restored.trace.json"), JSON.stringify({ commit, renderer: "dom", seed: "real-restored-shell", id, pid, incarnation, before, after: snapshot, fitted, record }, null, 2));
    await writeFile(join(dir, "real-restored.checks.json"), JSON.stringify(await read("window.__checks()"), null, 2));
    await browser("screenshot", join(dir, "real-restored.png"));
  } finally { await real.stop(); await rm(scratch, { recursive: true, force: true }); }
}, 180_000);
