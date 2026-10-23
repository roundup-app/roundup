import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const load = async (seed: string, base = false) => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  // The baseline server is separate from Vitest's warmed App server.
  const ready = await fetch(url("/__roundup_ready", base), { signal: AbortSignal.timeout(20_000) });

  expect(ready.status).toBe(204);
  await browser("open", url(`/harness.html?seed=${seed}&renderer=dom`, base));
  await wait("!!window.__fake && !!document.querySelector('.rail-row')");
};

const select = async (row: string, id: string) => {
  await read(`document.querySelector('.rail-row[data-id="${row}"]').click()`);
  await wait(`window.__terminals.has('${id}') && !!document.querySelector('.pane .xterm-screen')`);
  await read(`window.__terminals.get('${id}').ready`);
};

it("u3517b_loaded_metrics_drive_terminal_resize", async () => {
  await load("agents-10");
  await select("agent-3", "t-agent-3");
  const fitted = await read<{ cols: number; rows: number }>("window.__terminals.get('t-agent-3').fit()");
  const sent = () => read("window.__fake.app.calls.filter(call => call.method === 'terminal.resize' && call.params.id === 't-agent-3').at(-1).params");

  expect(await sent()).toEqual({ id: "t-agent-3", ...fitted });
  await read("window.__fake.app.calls.length = 0");
  await browser("set", "viewport", "1412", "950");
  await wait("window.__fake.app.calls.some(call => call.method === 'terminal.resize')");
  expect(await sent()).toEqual({ id: "t-agent-3", ...await read<object>("window.__terminals.get('t-agent-3').fit()") });
}, 90_000);

it("u3517d_rendering_changes_keep_input_and_scrollback", async () => {
  await load("agents-10");
  await select("agent-3", "t-agent-3");
  await read(`(async () => {
    window.__settings = await import('/src/settings/preferences.ts');
    const emulator = window.__terminals.get('t-agent-3');
    await new Promise(resolve => emulator.write(new TextEncoder().encode('\\x1b[2J\\x1b[H\\x1b]133;A\\x07$ command\\r\\n\\x1b]133;B\\x07' + Array.from({ length: 100 }, (_, i) => 'line ' + i).join('\\r\\n') + '\\r\\nunfinished 日本語'), resolve));
  })()`);
  await wait("window.__terminals.get('t-agent-3').turns().length === 1");
  const selected = () => read<string>("(() => { const emulator = window.__terminals.get('t-agent-3'); emulator.selectTurn(0, false); return emulator.selection(); })()");
  const before = await selected();
  expect(before).toContain("line 0");
  expect(before).toContain("unfinished 日本語");
  await read("window.__fake.app.calls.length = 0; window.__settings.saveAppSettings({ fontFamily: 'Menlo', fontSize: 17 })");
  await wait("window.__fake.app.calls.some(call => call.method === 'terminal.resize')");
  expect(await selected()).toBe(before);
  await read("window.__fake.app.calls.length = 0; window.__settings.saveAppSettings({ fontFamily: '', fontSize: 14 })");
  await wait("window.__fake.app.calls.some(call => call.method === 'terminal.resize')");
  expect(await selected()).toBe(before);
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'terminal.write')")).toEqual([]);
}, 90_000);

it.skipIf(!captureDir("U3517f"))("u3517f_rendered_terminal_reference", async () => {
  for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
    for (const state of ["agent", "door", "shell"]) {
      const seed = state === "agent" ? "agents-10" : "tree-40";

      await load(seed, base);
      await select(state === "agent" ? "agent-3" : "payments", state === "agent" ? "t-agent-3" : "t-payments");
      let id = state === "agent" ? "t-agent-3" : "t-payments";
      let surface = ".pane";

      if (state === "shell") {
        await read("document.querySelector('.terminal-new').click()");
        await wait("!!document.querySelector('.bubble:not([hidden]) .xterm-screen')");
        id = await read<string>("document.querySelector('.bubble:not([hidden])').dataset.bubble");
        surface = ".bubble:not([hidden])";
        await read(`window.__terminals.get('${id}').ready`);
      }

      await read(`(async () => {
        const emulator = window.__terminals.get('${id}');
        const samples = Array.from({ length: 16 }, (_, index) => '\\x1b[' + (index < 8 ? 30 + index : 90 + index - 8) + 'm ANSI ' + index + ' \\x1b[0m').join('');
        await new Promise(resolve => emulator.write(new TextEncoder().encode('\\x1b[2J\\x1b[H\\x1b]133;A\\x07Selected JetBrains Mono 0123456789\\r\\n\\x1b]133;D;0\\x07Regular 日本語 fallback\\r\\n\\x1b[1mBold sample\\x1b[0m \\x1b[3mItalic sample\\x1b[0m \\x1b[1;3mBold italic\\x1b[0m\\r\\n' + samples + '\\r\\n' + 'Long wrapped output '.repeat(40) + '\\r\\nunterminated input'), resolve));
        emulator.selectTurn(0, false);
        window.__fake.failNext(-32003, 'Output unavailable. Retry.');
        window.dispatchEvent(new Event('resize'));
      })()`);
      await wait("document.querySelector('.pane-failure')?.textContent.includes('Output unavailable. Retry.') || document.querySelector('.bubble-failure')?.textContent.includes('Output unavailable. Retry.')");

      const metrics = await read<{ fonts: { status: string }[] }>(`(() => {
        const screen = document.querySelector('${surface} .xterm-screen').getBoundingClientRect();
        const size = window.__terminals.get('${id}').fit();
        return { ...size, cellWidth: screen.width / size.cols, cellHeight: screen.height / size.rows, dpr: devicePixelRatio, fonts: [...document.fonts].map(face => ({ family: face.family, style: face.style, weight: face.weight, status: face.status })), resources: performance.getEntriesByType('resource').filter(r => r.name.includes('.woff2')).map(r => r.name) };
      })()`);

      if (!base) {
        expect(metrics.fonts).toHaveLength(4);
        expect(metrics.fonts.every(font => font.status === "loaded")).toBe(true);
      }

      for (const scenario of ["U3517b", "U3517c", "U3517f"]) {
        const dir = join(captureDir(scenario)!, base ? "base" : "head");

        mkdirSync(dir, { recursive: true });
        await browser("screenshot", join(dir, `${state}.png`));
        writeFileSync(join(dir, `${state}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
        writeFileSync(join(dir, `${state}.metrics.json`), JSON.stringify(metrics, null, 2));
      }
    }
  }
}, 180_000);
