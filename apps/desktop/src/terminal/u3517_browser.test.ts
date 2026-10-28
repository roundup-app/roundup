import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const load = async (seed: string, base = false, renderer = "dom") => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("open", url(`/harness.html?seed=${seed}&renderer=${renderer}`, base));
  await wait("!!window.__fake && !!document.querySelector('.rail-row')");
};

const select = async (row: string, id: string) => {
  await read(`document.querySelector('.rail-row[data-id="${row}"]').click()`);
  await wait(`window.__terminals.has('${id}') && !!document.querySelector('.pane .xterm-screen')`);
  await read(`window.__terminals.get('${id}').ready`);
};

it("u3517a_font_loading_keeps_live_terminal_input_available", async () => {
  await load("agents-10");
  await read(`(() => {
    const load = document.fonts.load.bind(document.fonts);
    let release;
    const prior = new Promise(resolve => { release = resolve; });
    document.fonts.load = async (...args) => { await prior; return load(...args); };
    window.__releaseFonts = () => { document.fonts.load = load; release(); };
    window.__fake.app.calls.length = 0;
    document.querySelector('.rail-row[data-id="agent-4"]').click();
  })()`);
  await browser("focus", '.rail-row[data-id="agent-4"]');
  await browser("press", "Enter");
  await wait("window.__terminals.has('t-agent-4') && !!document.querySelector('.pane .xterm-helper-textarea')");
  await browser("press", "x");
  await wait("window.__fake.app.calls.some(call => call.method === 'terminal.write' && call.params.id === 't-agent-4')");
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'terminal.resize' && call.params.id === 't-agent-4')")).toEqual([]);
  await read("window.__releaseFonts()");
  await wait("window.__fake.app.calls.some(call => call.method === 'terminal.resize' && call.params.id === 't-agent-4')");
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'terminal.write' && call.params.id === 't-agent-4').map(call => atob(call.params.data))")).toEqual(["x"]);
}, 60_000);

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
}, 60_000);

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
}, 60_000);

const captureIds = ["U3517b", "U3517c", "U3517f", "U4456a", "U4456b", "U4456c", "U4456d"].filter(id => captureDir(id));

for (const state of ["agent", "door", "shell"]) {
  it.skipIf(captureIds.length === 0)(`u3517f_rendered_terminal_reference_${state}`, async () => {
    for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
      const seed = state === "agent" ? "agents-10" : "tree-40";

      await read("localStorage.clear(); sessionStorage.clear()");
      await load(seed, base, "webgl");
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
        await new Promise(resolve => emulator.write(new TextEncoder().encode('\\x1b[2J\\x1b[H\\x1b]133;A\\x07Selected Terminal 0123456789\\r\\n\\x1b]133;D;0\\x07Regular 日本語 fallback\\r\\n\\x1b[1mBold sample\\x1b[0m \\x1b[3mItalic sample\\x1b[0m \\x1b[1;3mBold italic\\x1b[0m\\r\\n' + '\\x1b[90m┌────────────┬─────────┐\\r\\n│ Check      │ Result  │\\r\\n├────────────┼─────────┤\\r\\n│ Typography │ Ready   │\\r\\n└────────────┴─────────┘\\x1b[0m\\r\\n\\x1b[2mDim text and borders\\x1b[0m\\r\\n' + samples + '\\r\\n' + 'Long wrapped output '.repeat(40) + '\\r\\nunterminated input'), resolve));
        emulator.selectTurn(0, false);
        window.__fake.app.handlers['terminal.resize'] = window.__fake.app.handlers['terminal.write'] = () => { throw new Error('Output unavailable. Retry.'); };
        emulator.paste('retry');
      })()`);
      await wait("document.querySelector('.pane-failure')?.textContent.includes('Output unavailable. Retry.') || document.querySelector('.bubble-failure')?.textContent.includes('Output unavailable. Retry.')");

      const metrics = await read<{ fonts: { status: string }[] }>(`(() => {
        const screen = document.querySelector('${surface} .xterm-screen').getBoundingClientRect();
        const size = window.__terminals.get('${id}').fit();
        return { ...size, cellWidth: screen.width / size.cols, cellHeight: screen.height / size.rows, dpr: devicePixelRatio, renderer: document.querySelector('${surface} .xterm-screen canvas') ? "webgl" : "dom", fonts: [...document.fonts].map(face => ({ family: face.family, style: face.style, weight: face.weight, status: face.status })), resources: performance.getEntriesByType('resource').filter(r => r.name.includes('.woff2')).map(r => r.name) };
      })()`);

      const checks = JSON.stringify(await read("window.__checks()"), null, 2);
      let screenshot: string | undefined;

      for (const scenario of captureIds) {
        const dir = join(captureDir(scenario)!, base ? "base" : "head");

        mkdirSync(dir, { recursive: true });
        const path = join(dir, `${state}.png`);

        if (screenshot) copyFileSync(screenshot, path);
        else { await browser("screenshot", path); screenshot = path; }

        writeFileSync(join(dir, `${state}.checks.json`), checks);
        writeFileSync(join(dir, `${state}.metrics.json`), JSON.stringify(metrics, null, 2));
      }
    }
  }, 60_000);
}


const groundOutput = captureDir("U4456c");
const groundCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const groundCapture = async (base: boolean, seed: string, scheme: string, step: string) => {
  const dir = join(groundOutput!, base ? "base" : "head");
  const name = `${scheme}-${seed}-${step}`;
  const readings = await read(`(() => {
    const roots = [document];
    const surfaces = [];
    for (const root of roots) for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
      if (!element.checkVisibility()) continue;
      const style = getComputedStyle(element);
      if (style.backgroundColor !== 'rgba(0, 0, 0, 0)') surfaces.push({
        tag: element.tagName, class: element.getAttribute('class'),
        background: style.backgroundColor, colour: style.color,
      });
    }
    const style = getComputedStyle(document.documentElement);
    return { mode: document.documentElement.dataset.mode,
      hostDark: matchMedia('(prefers-color-scheme: dark)').matches,
      contrast: matchMedia('(prefers-contrast: more)').matches,
      tokens: Object.fromEntries(['--ground','--sunken','--terminal-background','--surface','--selected','--disabled'].map(name => [name, style.getPropertyValue(name).trim()])), surfaces };
  })()`);
  mkdirSync(dir, { recursive: true });
  await browser("screenshot", join(dir, `${name}.png`));
  writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
  writeFileSync(join(dir, `${name}.colours.json`), JSON.stringify({ commit: base ? process.env.U4456_BASE_SHA : groundCommit, seed, scheme, step, readings }, null, 2));
};

const groundLoad = async (seed: string, base: boolean, scheme: string) => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", scheme === "explicit" ? "light" : "dark");
  await browser("open", url(`/harness.html?seed=${seed}`, base));
  await wait("!!window.__fake && !!document.querySelector('.window')");
  await read(`(async () => {
    localStorage.clear(); sessionStorage.clear();
    const { saveAppSettings } = await import('/src/settings/preferences.ts');
    await saveAppSettings({ mode: '${scheme === "explicit" ? "dark" : "system"}' });
  })()`);
  await wait(`document.documentElement.dataset.mode === '${scheme === "explicit" ? "dark" : "system"}'`);
};

for (const scheme of ["system", "explicit"]) {
  for (const seed of ["first-run", "empty-project", "door-stopped", "agents-10", "tree-40"]) {
    it.skipIf(!groundOutput)(`u4456c_window_ground_${scheme}_${seed}`, async () => {
      for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
        await groundLoad(seed, base, scheme);
        await groundCapture(base, seed, scheme, "rest");
        if (seed === "agents-10" || seed === "tree-40") {
          await select(seed === "agents-10" ? "agent-3" : "payments", seed === "agents-10" ? "t-agent-3" : "t-payments");
          await groundCapture(base, seed, scheme, "pane-prompt");
          await read(`(() => {
            window.__fake.app.handlers['terminal.write'] = () => { throw new Error('Output unavailable. Retry.'); };
            window.__terminals.get('${seed === "agents-10" ? "t-agent-3" : "t-payments"}').paste('retry');
          })()`);
          await wait("document.querySelector('.pane-failure')?.textContent.includes('Output unavailable. Retry.')");
          await groundCapture(base, seed, scheme, "failure");
        }
      }
    }, 120_000);
  }
}

for (const [surface, seed, command, selector] of [
  ["settings", "tree-40", "settings", ".settings-view"],
  ["inbox", "tree-40", "view:inbox", ".inbox"],
  ["reactions", "tree-40", "view:reactions", ".reactions"],
  ["resources", "resources", "view:resources", ".resource-inspection"],
  ["import", "import-candidates", "import-work", ".import-panel"],
]) {
  it.skipIf(!groundOutput)(`u4456c_secondary_ground_${surface}`, async () => {
    for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
      await groundLoad(seed!, base, "system");
      if (surface === "resources") await read("document.querySelector('.rail-row[data-id=worktree-agent]').click()");
      await read(command === "settings" ? "window.dispatchEvent(new Event('open-app-settings'))" : `window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path:'/Users/you/harness',command:'${command}'}}))`);
      await wait(`!!document.querySelector('${selector}')`);
      await groundCapture(base, seed!, "system", surface!);
      if (surface === "settings") {
        await browser("click", '[role=tab][data-value="Appearance"]');
        await groundCapture(base, seed!, "system", "appearance");
      }
    }
  }, 120_000);
}
