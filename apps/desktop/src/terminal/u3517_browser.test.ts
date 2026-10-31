import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { browser, read, url, wait } from "../ui/tabsBrowser";

const load = async (seed: string, base = false, renderer = "dom", scale = 1) => {
  await browser("set", "viewport", "1512", "950", String(scale));
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

it("u4590_first_fit_keeps_later_output_visible", async () => {
  await browser("open", url("/src/ui/u498.html"));
  await read("localStorage.clear(); sessionStorage.clear()");
  await load("agents-10");
  await read(`(async () => {
    const { FitAddon } = await import(performance.getEntriesByType('resource').find(entry => entry.name.includes('/@xterm_addon-fit.js')).name);
    const activate = FitAddon.prototype.activate;
    FitAddon.prototype.activate = function(terminal) {
      window.__fitter = this;
      FitAddon.prototype.activate = activate;
      return activate.call(this, terminal);
    };
    const fonts = document.fonts;
    const load = fonts.load.bind(fonts);
    const ready = fonts.ready;
    let releaseLoad, releaseReady;
    const loading = new Promise(resolve => { releaseLoad = resolve; });
    const layout = new Promise(resolve => { releaseReady = resolve; });
    fonts.load = async (...args) => { await loading; const result = await load(...args); window.__faceLoaded = true; return result; };
    Object.defineProperty(fonts, 'ready', { configurable: true, value: Promise.all([ready, layout]) });
    window.__releaseFaces = releaseLoad;
    window.__releaseReady = () => { fonts.load = load; releaseReady(); };
    window.__fake.app.calls.length = 0;
    document.querySelector('.rail-row[data-id="agent-4"]').click();
  })()`);
  await wait("!!window.__fitter && !!document.querySelector('.pane .xterm-screen')");
  await read("window.__releaseFaces()");
  await wait("window.__faceLoaded === true");
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'terminal.resize' && call.params.id === 't-agent-4')")).toEqual([]);
  await read(`(async () => {
    window.__host = document.querySelector('.pane-screen');
    window.__screen = window.__host.querySelector('.xterm-screen');
    window.__emulator = window.__terminals.get('t-agent-4');
    window.__releaseReady();
    await document.fonts.ready;
    // U4590's deliberate late-layout stimulus, one frame after font readiness.
    await new Promise(resolve => requestAnimationFrame(resolve));
    window.__host.style.width = '73%';
    window.__host.style.height = '81%';
    window.__finalGrid = window.__fitter.proposeDimensions();
  })()`);
  await wait("(() => { const sent = window.__fake.app.calls.filter(call => call.method === 'terminal.resize' && call.params.id === 't-agent-4').at(-1)?.params; const grid = window.__finalGrid; return sent?.cols === grid.cols && sent?.rows === grid.rows; })()");
  const fitted = await read<object>("window.__fitter.proposeDimensions()");
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'terminal.resize' && call.params.id === 't-agent-4').at(-1).params")).toEqual({ id: "t-agent-4", ...fitted });
  await read("window.__fake.writeOutput('t-agent-4', '\\r\\nU4590 later subscription output\\r\\n')");
  await wait("window.__emulator.serialize().data.includes('U4590 later subscription output') && window.__host.querySelector('.xterm-rows')?.textContent.includes('U4590 later subscription output')");
  expect(await read("window.__host === document.querySelector('.pane-screen') && window.__screen === window.__host.querySelector('.xterm-screen') && window.__emulator === window.__terminals.get('t-agent-4')")).toBe(true);
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'terminal.write')")).toEqual([]);
}, 60_000);

it("u3517b_loaded_metrics_drive_terminal_resize", async () => {
  await load("agents-10");
  await select("agent-3", "t-agent-3");
  const sent = () => read("window.__fake.app.calls.filter(call => call.method === 'terminal.resize' && call.params.id === 't-agent-3').at(-1).params");

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

const captureIds = ["U3517b", "U3517c", "U3517f", "U4456a", "U4456b", "U4456c", "U4456d", "U4592", "U4649"].filter(id => captureDir(id));

const replay = [
  "\x1b[2J\x1b[H\x1b]133;A\x07Selected Terminal 0123456789",
  "\x1b]133;D;0\x07Regular Example answer -> => != ===",
  "\x1b[1mRegular Example answer -> => != ===\x1b[0m",
  "\x1b[3mItalic sample\x1b[0m \x1b[1;3mBold italic\x1b[0m",
  "Example answer",
  "\x1b[90m┌────────────┬─────────┐",
  "│ Example    │ Answer  │",
  "├────────────┼─────────┤",
  "│ Typography │ Ready   │",
  "└────────────┴─────────┘\x1b[0m",
  "\x1b[2mDim text and borders\x1b[0m",
  Array.from({ length: 16 }, (_, index) => `\x1b[${index < 8 ? 30 + index : 90 + index - 8}m ANSI ${index} \x1b[0m`).join(""),
  "Long wrapped output ".repeat(40),
  "unterminated input",
].join("\r\n");

const arabic = Boolean(captureDir("U4649"));

const arabicReplay = [
  "\x1b[2J\x1b[H  أنا جاهز. قولّي عايز نشتغل على إيه؟",
  'Noted: my Rail name is "عامل-إيه-في". Done.',
  "abc عامل 123 جاهز! xyz",
  "Ordinary English -> => != ===",
  "",
].join("\r\n");

for (const { state, renderer } of ["agent", "door", "shell"].flatMap(state =>
  (arabic ? ["webgl", "dom"] : ["webgl"]).map(renderer => ({ state, renderer })))) {
  it.skipIf(captureIds.length === 0)(`${arabic ? "u4649" : "u3517f"}_rendered_terminal_reference_${state}_${renderer}`, async () => {
    for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
      const seed = state === "agent" ? "agents-10" : "tree-40";

      // Reset preferences on the target origin before mounting its App.
      await browser("open", url("/src/ui/u498.html", base));
      await read("localStorage.clear(); sessionStorage.clear()");
      await load(seed, base, renderer, arabic ? 1 : 2);
      await select(state === "agent" ? "agent-3" : "payments", state === "agent" ? "t-agent-3" : "t-payments");
      let id = state === "agent" ? "t-agent-3" : "t-payments";
      let surface = ".pane";

      if (state === "shell") {
        await read("document.querySelector('.terminal-new').click()");
        await wait("!!document.querySelector('.bubble:not([hidden]) .xterm-screen') && !!document.querySelector('.bubble:not([hidden]) [aria-label=Minimise]')");
        id = await read<string>("document.querySelector('.bubble:not([hidden])').dataset.bubble");
        surface = ".bubble:not([hidden])";
        await read(`window.__terminals.get('${id}').ready`);
      }

      const initialRenderer = await read<string>(`document.querySelector('${surface} .xterm-screen canvas') ? "webgl" : "dom"`);

      if (arabic && initialRenderer !== renderer) throw new Error(`Requested ${renderer}, started with ${initialRenderer}`);

      const stream = arabic ? arabicReplay : replay;
      await read(`window.__fake.writeOutput('${id}', ${JSON.stringify(stream)})`);
      await wait(`window.__terminals.get('${id}').serialize().data.includes('${arabic ? "Ordinary English" : "unterminated input"}')`);
      await read(`(async () => {
        const emulator = window.__terminals.get('${id}');
        // xterm schedules painting after its parser callback; the next animation frame drains that render.
        await new Promise(resolve => requestAnimationFrame(resolve));
        window.__fake.app.handlers['terminal.resize'] = window.__fake.app.handlers['terminal.write'] = () => { throw new Error('Output unavailable. Retry.'); };
        emulator.paste('retry');
      })()`);
      await wait("document.querySelector('.pane-failure')?.textContent.includes('Output unavailable. Retry.') || document.querySelector('.bubble-failure')?.textContent.includes('Output unavailable. Retry.')");

      const metrics = await read<{ fonts: { status: string }[]; cellWidth: number; cellHeight: number; renderer: string }>(`(() => {
        const screen = document.querySelector('${surface} .xterm-screen').getBoundingClientRect();
        const size = window.__terminals.get('${id}').fit();
        return { ...size, cellWidth: screen.width / size.cols, cellHeight: screen.height / size.rows, dpr: devicePixelRatio, renderer: document.querySelector('${surface} .xterm-screen canvas') ? "webgl" : "dom", fonts: [...document.fonts].map(face => ({ family: face.family, style: face.style, weight: face.weight, status: face.status })), resources: performance.getEntriesByType('resource').filter(r => r.name.includes('.woff2')).map(r => r.name) };
      })()`);

      const metadata = await read<{
        host: { width: number; height: number; x: number; y: number };
        viewport: { width: number; height: number };
        canvas: { width: number; height: number; cssWidth: number; cssHeight: number } | null;
        requested: { family: string; weight: number; bold: number; size: number; tracking: number; lineHeight: number };
        tokens: Record<string, string>;
        fontStatus: string;
        smoothing: string;
      }>(`(async () => {
        const host = document.querySelector('${surface}');
        const canvas = host.querySelector('.xterm-screen canvas:not(.xterm-link-layer)');
        const {width, height, x, y} = host.getBoundingClientRect();
        const style = getComputedStyle(document.documentElement);
        const { xtermOptions } = await import('/src/terminal/emulator.ts');

        return { host: {width,height,x,y}, requested: {family:xtermOptions.fontFamily,weight:xtermOptions.fontWeight ?? 400,bold:xtermOptions.fontWeightBold ?? 700,size:xtermOptions.fontSize,tracking:xtermOptions.letterSpacing,lineHeight:xtermOptions.lineHeight}, viewport: {width:innerWidth,height:innerHeight},
          canvas: canvas ? {width:canvas.width,height:canvas.height,cssWidth:canvas.getBoundingClientRect().width,cssHeight:canvas.getBoundingClientRect().height} : null,
          tokens: Object.fromEntries(['--font-terminal','--text-terminal','--line-terminal','--letter-terminal','--weight-terminal'].map(name => [name, style.getPropertyValue(name).trim()])),
          fontStatus: document.fonts.status, smoothing: style.webkitFontSmoothing };
      })()`);

      await read(`(async () => {
        const emulator = window.__terminals.get('${id}');
        if (!${arabic}) emulator.selectTurn(emulator.turns().length - 1, false);
        // selectLines schedules xterm's next render frame; paint selection after the failed paste clears it.
        await new Promise(resolve => requestAnimationFrame(resolve));
      })()`);

      const record = { ...metrics, ...metadata, commit: execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8', cwd: base ? process.env.U500_BASE_ROOT : process.cwd()}).trim(),
        seed, state, initialRenderer, candidate: arabic ? 'arabic' : 'selected',
        streamIdentity: createHash('sha256').update(stream).digest('hex'),
        claudeVersion: 'deterministic Claude Code-style replay; no live Claude process', platform: process.platform };

      const checks = JSON.stringify(await read("window.__checks()"), null, 2);
      let screenshot: string | undefined;

      for (const scenario of captureIds) {
        const dir = join(captureDir(scenario)!, base ? "base" : "head");

        mkdirSync(dir, { recursive: true });
        const step = scenario === "U4649" ? `${state}-${renderer}` : state;
        const path = join(dir, `${step}.png`);

        if (screenshot) copyFileSync(screenshot, path);
        else { await browser("screenshot", path); screenshot = path; }

        writeFileSync(join(dir, `${step}.checks.json`), checks);
        writeFileSync(join(dir, `${step}.metrics.json`), JSON.stringify(record, null, 2));

        if (scenario === "U4649") {
          if (!base && metrics.renderer !== "dom") throw new Error(`Arabic must use the unclipped DOM renderer; requested ${renderer}, painted ${metrics.renderer}`);

          if (metadata.fontStatus !== "loaded") throw new Error("Terminal fonts have not loaded");

          // Browser-native reference: one fillText per Arabic stretch, at its logical cell.
          // This is an observer artifact, never part of the App or its renderer.
          const reference = await read<string>(`(async () => {
            const { xtermOptions } = await import('/src/terminal/emulator.ts');
            const canvas = document.createElement('canvas');
            const cellWidth = ${metrics.cellWidth};
            const cellHeight = ${metrics.cellHeight};
            canvas.width = Math.ceil(cellWidth * 65 * devicePixelRatio);
            canvas.height = Math.ceil(cellHeight * 4 * devicePixelRatio);
            const ctx = canvas.getContext('2d');
            ctx.scale(devicePixelRatio, devicePixelRatio);
            ctx.fillStyle = xtermOptions.theme.background;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = xtermOptions.theme.foreground;
            ctx.font = xtermOptions.fontWeight + ' ' + xtermOptions.fontSize + 'px ' + xtermOptions.fontFamily;
            ctx.textBaseline = 'middle';
            ctx.direction = 'ltr';
            const rows = [
              [[0, '  '], [2, 'أنا جاهز. قولّي عايز نشتغل على إيه؟']],
              [[0, 'Noted: my Rail name is "'], [24, 'عامل-إيه-في'], [35, '". Done.']],
              [[0, 'abc '], [4, 'عامل 123 جاهز!'], [18, ' xyz']],
              [[0, 'Ordinary English -> => != ===']],
            ];
            rows.forEach((runs, row) => runs.forEach(([col, text]) => ctx.fillText(text, col * cellWidth, (row + 0.5) * cellHeight)));
            return canvas.toDataURL('image/png').split(',')[1];
          })()`);

          writeFileSync(join(dir, `${step}-reference.png`), Buffer.from(reference, "base64"));
        }
      }
    }
  }, 60_000);
}


const groundOutput = captureDir("U4456c");


const groundCapture = async (base: boolean, seed: string, scheme: string, step: string) => {
  const dir = join(groundOutput!, base ? "base" : "head");
  const name = `${scheme}${process.env.U4456_CONTRAST ? "-contrast" : ""}-${seed}-${step}`;

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
      forcedColours: matchMedia('(forced-colors: active)').matches,
      tokens: Object.fromEntries(['--ground','--sunken','--terminal-background','--surface','--selected','--disabled'].map(name => [name, style.getPropertyValue(name).trim()])), surfaces };
  })()`);

  mkdirSync(dir, { recursive: true });
  await browser("screenshot", join(dir, `${name}.png`));
  writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
  writeFileSync(join(dir, `${name}.colours.json`), JSON.stringify({ commit: base ? process.env.U4456_BASE_SHA : execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), seed, scheme, step, readings }, null, 2));
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

  if (process.env.U4456_CONTRAST && !await read("matchMedia('(prefers-contrast: more)').matches")) throw new Error('Increased contrast observer did not activate');
};

for (const scheme of ["system", "explicit"]) {
  for (const seed of ["first-run", "empty-project", "door-stopped", "agents-10", "tree-40"]) {
    it.skipIf(!groundOutput)(`u4456c_window_ground_${scheme}_${seed}`, async () => {
      for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
        await groundLoad(seed, base, scheme);
        await groundCapture(base, seed, scheme, "rest");

        if (seed === "empty-project") {
          const id = await read<string>("window.__fake.app.rpc('rail.createWorkstream', {name:'Empty work',parent:null}).then(node => node.id)");
          await wait(`!!document.querySelector('.rail-row[data-id="${id}"]')`);
          await browser("click", `.rail-row[data-id="${id}"]`);
          await groundCapture(base, seed, scheme, "empty-workstream");
        }

        if (seed === "door-stopped") {
          await browser("click", '.rail-row[data-id="first-workstream"]');
          await groundCapture(base, seed, scheme, "stopped-door");
        }

        if (seed === "agents-10" || seed === "tree-40") {
          await select(seed === "agents-10" ? "agent-4" : "payments", seed === "agents-10" ? "t-agent-4" : "t-payments");
          await groundCapture(base, seed, scheme, "pane-prompt");
          await read(`(() => {
            window.__fake.app.handlers['terminal.resize'] = window.__fake.app.handlers['terminal.write'] = () => { throw new Error('Output unavailable. Retry.'); };
            window.__terminals.get('${seed === "agents-10" ? "t-agent-4" : "t-payments"}').paste('retry');
          })()`);
          await browser("set", "viewport", "1412", "950");
          await browser("set", "viewport", "1512", "950");
          await wait("document.querySelector('.pane-failure')?.textContent.includes('Output unavailable. Retry.')");
          await groundCapture(base, seed, scheme, "failure");
        }
      }
    }, 120_000);
  }
}

for (const [surface, seed, command, selector] of [
  ["settings", "tree-40", "settings", ".settings-view"],
  ["inbox", "tree-40", "inbox", ".inbox"],
  ["reactions", "tree-40", "view:reactions", ".reactions"],
  ["resources", "resources", "view:resources", ".resource-inspection"],
  ["import", "import-candidates", "import-work", ".import-panel"],
]) {
  it.skipIf(!groundOutput)(`u4456c_secondary_ground_${surface}`, async () => {
    for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
      await groundLoad(seed!, base, "system");

      if (surface === "resources") await read("document.querySelector('.rail-row[data-id=worktree-agent]').click()");

      if (surface === "inbox") {
        await browser("press", "Meta+k");
        await browser("press", "i");
      } else await read(command === "settings" ? "window.dispatchEvent(new Event('open-app-settings'))" : `window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path:'/Users/you/harness',command:'${command}'}}))`);
      await wait(`!!document.querySelector('${selector}')`);
      await groundCapture(base, seed!, "system", surface!);

      if (surface === "settings") {
        await browser("click", '[role=tab][data-value="Appearance"]');
        await groundCapture(base, seed!, "system", "appearance");
      }
    }
  }, 120_000);
}


it.skipIf(!groundOutput)("u4456c_shelf_drawers_and_visual_content", async () => {
  for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
    await groundLoad("tree-40", base, "system");
    await browser("click", "[data-todo-root]");
    await read("if(document.querySelector('#shelf-tab-todos')?.getAttribute('aria-expanded') !== 'true') document.querySelector('#shelf-tab-todos').click()");
    await wait("!!document.querySelector('.shelf')");
    await read("for (const control of document.querySelectorAll('[data-shelf-group] [data-part=branch-control]')) if (control.closest('[role=treeitem]')?.getAttribute('aria-expanded') === 'false') control.click()");
    await wait("[...document.querySelectorAll('.todo-row-button')].some(row => row.checkVisibility())");
    await groundCapture(base, "tree-40", "system", "shelf");
    await read("[...document.querySelectorAll('.todo-row-button')].find(row => row.checkVisibility()).focus()");
    await browser("press", "Enter");
    await wait("!!document.querySelector('.drawer[data-open=true]')");
    await groundCapture(base, "tree-40", "system", "todo-drawer");
    await browser("press", "Escape");
    await browser("click", "#shelf-tab-pads");
    const text = 'Diagram\n\n```mermaid\ngraph LR\nA-->B\n```\n\n```excalidraw\n{"type":"excalidraw","elements":[]}\n```\n';
    await read(`window.__fake.app.rpc('pad.write', ${JSON.stringify({ name: "pad-3", text })})`);
    await wait("[...document.querySelectorAll('.pad-name')].some(row => row.textContent === 'pad-3')");
    await read("[...document.querySelectorAll('.pad-name')].find(row => row.textContent === 'pad-3').focus()");
    await browser("press", "Enter");
    await wait("!!document.querySelector('.visual-mermaid svg') && !!document.querySelector('.visual-drawing .excalidraw')");
    await groundCapture(base, "tree-40", "system", "pad-diagram-drawing");
    await browser("scrollintoview", ".visual-drawing .excalidraw");
    await groundCapture(base, "tree-40", "system", "drawing-chrome");
  }
}, 120_000);

it.skipIf(!groundOutput)("u4456c_floating_menu_picker_dialog", async () => {
  for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
    await groundLoad("tree-40", base, "system");
    await browser("click", "[data-todo-root]");
    await read("if(document.querySelector('#shelf-tab-todos')?.getAttribute('aria-expanded') !== 'true') document.querySelector('#shelf-tab-todos').click(); for (const control of document.querySelectorAll('[data-shelf-group] [data-part=branch-control]')) if (control.closest('[role=treeitem]')?.getAttribute('aria-expanded') === 'false') control.click()");
    await wait("[...document.querySelectorAll('.todo-row-button')].some(row => row.checkVisibility())");
    await read("[...document.querySelectorAll('.todo-row-button')].find(row => row.checkVisibility()).focus()");
    await read("window.__fake.app.rpc('todo.list', null).then(todos => { const row = [...document.querySelectorAll('.todo-row-button')].find(row => row.checkVisibility() && todos.some(todo => !todo.done && todo.id === Number(row.closest('[data-todo]')?.dataset.todo))); row.focus(); row.dispatchEvent(new KeyboardEvent('keydown', {key:'o',code:'KeyO',bubbles:true,cancelable:true})); })");
    await wait("!!document.querySelector('[role=menu]')");
    await groundCapture(base, "tree-40", "system", "owner-menu");
    await read("[...document.querySelectorAll('[role=menuitem]')].find(button => button.textContent.includes('New Workstream')).click()");
    await wait("!!document.querySelector('.new-workstream')");
    await groundCapture(base, "tree-40", "system", "dialog");
    await read("[...document.querySelectorAll('.new-workstream label')].find(label => label.textContent.includes('Start after Todo')).click()");
    await browser("click", ".app-dialog-pick");
    await wait("!!document.querySelector('.todo-blocker-menu [role=combobox]')");
    await groundCapture(base, "tree-40", "system", "picker");
  }
}, 120_000);

it.skipIf(!groundOutput)("u4456c_changes_tree_and_diff", async () => {
  for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
    await browser("set", "media", "dark");
    await browser("open", url('/src/changes/u2540.html?dense', base));
    await wait("!!window.__fake && !!document.querySelector('.worktree-control')");
    await browser("click", ".worktree-control");
    await wait("!!document.querySelector('file-tree-container')?.shadowRoot?.querySelector('[data-item-type=file]')");
    await groundCapture(base, "changes-fixture", "system", "changes-tree");
    await read("document.querySelector('file-tree-container').shadowRoot.querySelector('[data-item-type=file]').click()");
    await browser("find", "role", "button", "click", "--name", "View diff", "--exact");
    await wait("!!document.querySelector('diffs-container')?.shadowRoot?.querySelector('[data-column-number]')");
    await groundCapture(base, "changes-fixture", "system", "diff");
  }
}, 120_000);

it.skipIf(!groundOutput)("u4456c_ask_and_tooltip", async () => {
  for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
    await groundLoad("tree-40", base, "system");
    await browser("click", "[data-todo-root]");
    await wait("!!document.querySelector('.ask-input')?.checkVisibility()");
    await browser("click", ".ask-input");
    await browser("keyboard", "type", "@");
    await wait("!!document.querySelector('.app-mentions')");
    await groundCapture(base, "tree-40", "system", "ask-mentions");
    await browser("press", "Escape");
    await browser("hover", ".terminal-new");
    await wait("!!document.querySelector('[role=tooltip]')");
    await groundCapture(base, "tree-40", "system", "tooltip");
  }
}, 120_000);

const arabicCapture = captureDir("U4679");

for (const state of ["agent", "door", "shell"]) for (const renderer of ["webgl", "dom"]) for (const prompt of ["$ ", "❯ "]) {
  it.skipIf(!arabicCapture)(`u4679_rendered_incremental_arabic_${state}_${renderer}_${prompt}`, async () => {
    const dir = join(arabicCapture!, process.env.U4679_PHASE ?? "head");
    mkdirSync(dir, { recursive: true });
    await load(state === "agent" ? "agents-10" : "tree-40", process.env.U4679_PHASE === "base", renderer);
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

    const name = `${state}-${renderer}-${prompt === "$ " ? "shell" : "claude"}`;

    const output = async (text: string) => {
      await read(`(() => {
        window.__fake.writeOutput('${id}', ${JSON.stringify(text)});
        // screens.ts drains this short chunk synchronously into xterm; its empty write acknowledges parsing.
        return new Promise(resolve => window.__terminals.get('${id}').write(new Uint8Array(), resolve));
      })()`);
      // emulator.ts onRender follows xterm's queued parser callback; the queued animation frame drains its paint.
      await read("new Promise(resolve => requestAnimationFrame(resolve))");
    };

    const capture = async (step: string, text: string) => {
      // Reference uses the same browser text engine, face, weight and size, independent of xterm's joined cells.
      const metrics = await read(`(async () => {
        const {xtermOptions} = await import('/src/terminal/emulator.ts');
        let reference = document.getElementById('arabic-reference');
        if (!reference) { reference = document.createElement('div'); reference.id = 'arabic-reference'; document.body.append(reference); }
        Object.assign(reference.style, {position:'fixed', zIndex:'2147483647', right:'20px', bottom:'20px', background:'var(--terminal-background)', color:'var(--terminal-foreground)', fontFamily:xtermOptions.fontFamily, fontSize:xtermOptions.fontSize+'px', fontWeight:xtermOptions.fontWeight, whiteSpace:'pre'});
        reference.textContent = ${JSON.stringify(text)};
        const emulator = window.__terminals.get('${id}');
        return {requested:${JSON.stringify(renderer)}, renderer:document.querySelector('${surface} .xterm-screen canvas')?'webgl':'dom', snapshot:emulator.serialize(), selection:emulator.selection(), calls:window.__fake.app.calls.filter(c=>c.method==='terminal.write' && c.params.id==='${id}'), fontStatus:document.fonts.status};
      })()`);

      await browser("screenshot", join(dir, `${name}-${step}.png`));
      writeFileSync(join(dir, `${name}-${step}.metrics.json`), JSON.stringify(metrics, null, 2));
    };

    await output('\x1b[2J\x1b[H\x1b[32mGREEN \x1b[33m⚡ \x1b[34mBLUE\x1b[0m\r\n' + prompt);
    await read(`window.__fake.app.calls.length=0; window.__terminals.get('${id}').focus()`);
    let text = "";

    for (const letter of "عربي") {
      await browser("keyboard", "inserttext", letter);
      await wait(`window.__fake.app.calls.filter(c=>c.method==='terminal.write' && c.params.id==='${id}').length === ${text.length + 1}`);
      text += letter;
      await output(prompt === "$ " ? letter : '\r\x1b[2K' + prompt + text);
      await capture(`prefix-${text.length}`, text);
    }

    expect(await read(`window.__fake.app.calls.filter(c=>c.method==='terminal.write' && c.params.id==='${id}').map(c=>c.params.data)`)).toEqual(["2Lk=", "2LE=", "2Kg=", "2Yo="]);
    await output('\r\x1b[2K' + prompt + 'abc عربي 123');
    await browser("press", "Backspace");
    await wait(`window.__fake.app.calls.filter(c=>c.method==='terminal.write').at(-1)?.params.data === 'fw=='`);
    await output('\r\x1b[2K' + prompt + 'abc عربي 12');
    await browser("keyboard", "inserttext", " سَلَام");
    await wait(`window.__fake.app.calls.filter(c=>c.method==='terminal.write').length === 6`);
    await output('\r\x1b[2K' + prompt + '🚀 abc عربي 12 سَلَام ASCII');
    await capture("mixed", '🚀 abc عربي 12 سَلَام ASCII');
    const cols = await read<number>(`window.__terminals.get('${id}').serialize().cols`);
    await output('\r\x1b[2K' + ' '.repeat(cols - 2) + 'عربي');
    await capture("wrap", 'عربي');
    await output('\r\x1b[2K' + prompt + 'عربي\r\nASCII after Arabic');
    await capture("redraw", 'عربي');
    await read(`window.__fake.app.handlers['terminal.resize'] = window.__fake.app.handlers['terminal.write'] = () => {throw new Error('Output unavailable. Retry.');}; window.__terminals.get('${id}').paste('retry')`);
    await wait("!!document.querySelector('.pane-failure, .bubble-failure')");
    await capture("failure", 'عربي');
    await read("document.getElementById('arabic-reference')?.remove()");
    await browser("screenshot", join(dir, `${name}-checks.png`));
    writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
  }, 60_000);
}

it("u4590_visible_shell_waits_for_destination_fonts_before_launch", async () => {
  await load("tree-40");
  await read(`(() => {
    const load = document.fonts.load.bind(document.fonts);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    document.fonts.load = async (...args) => { await gate; return load(...args); };
    window.__releaseFonts = () => { document.fonts.load = load; release(); };
    window.__fake.app.calls.length = 0;
    document.querySelector('.terminal-new').click();
  })()`);
  await wait("!!document.querySelector('.bubble:not([hidden]) .xterm-screen')");
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'terminal.open')")).toEqual([]);
  const captures = captureDir("U4590");

  if (captures) await read(`(() => {
    const open = window.__fake.app.handlers['terminal.open'];
    const receipt = new Promise(resolve => { window.__releaseLaunch = resolve; });
    window.__fake.app.handlers['terminal.open'] = async params => { await receipt; return open(params); };
  })()`);

  await read("window.__releaseFonts()");
  await wait("window.__fake.app.calls.some(call => call.method === 'terminal.open')");

  if (captures) {
    // Capture the pending receipt without spending the font-readiness deadline on a screenshot.
    mkdirSync(captures, { recursive: true });
    await browser("screenshot", join(captures, "shell-preparing.png"));
    writeFileSync(join(captures, "shell-preparing.checks.json"), JSON.stringify(await read("window.__checks()"), null, 2));
    await read("window.__releaseLaunch()");
  }

  const params = await read<{ cols: number; rows: number }>("window.__fake.app.calls.find(call => call.method === 'terminal.open').params");
  expect(params.cols).toBeGreaterThan(0);
  expect(params.rows).toBeGreaterThan(0);
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'terminal.write')")).toEqual([]);
}, 60_000);


it("u4590_preparing_an_agent_keeps_the_selected_terminal_usable", async () => {
  await load("agents-10");
  await select("agent-3", "t-agent-3");
  await read("window.__fake.writeOutput('t-agent-3', 'Existing Terminal stays usable\\r\\n')");
  await wait("document.querySelector('.pane .xterm-rows')?.textContent.includes('Existing Terminal stays usable')");
  await read(`(() => {
    window.__previousInput = document.querySelector('.pane .xterm-helper-textarea');
    const load = document.fonts.load.bind(document.fonts);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    document.fonts.load = async (...args) => { await gate; return load(...args); };
    window.__releaseFonts = () => { document.fonts.load = load; release(); };
    window.__fake.app.calls.length = 0;
    document.querySelector('.rail-actions [aria-label="New Agent"]').click();
  })()`);
  await wait("document.querySelectorAll('.pane .xterm-screen').length === 2");
  expect(await read("window.__previousInput.isConnected")).toBe(true);
  await read("window.__previousInput.focus()");
  await browser("press", "x");
  await wait("window.__fake.app.calls.some(call => call.method === 'terminal.write' && call.params.id === 't-agent-3')");
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'agent.spawn')")).toEqual([]);
  const captures = captureDir("U4590");

  if (captures) {
    mkdirSync(captures, { recursive: true });
    await browser("screenshot", join(captures, "agent-preparing-keeps-terminal.png"));
    writeFileSync(join(captures, "agent-preparing-keeps-terminal.checks.json"), JSON.stringify(await read("window.__checks()"), null, 2));
  }

  await read("window.__releaseFonts()");
  await wait("window.__fake.app.calls.some(call => call.method === 'agent.spawn')");
}, 60_000);


it.each(["close", "minimise", "Escape"])("u4590_preparing_shell_cancels_with_%s", async action => {
  await load("tree-40");
  await read(`(() => {
    const load = document.fonts.load.bind(document.fonts);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    document.fonts.load = async (...args) => { await gate; return load(...args); };
    window.__releaseFonts = () => { document.fonts.load = load; release(); };
    window.__fake.app.calls.length = 0;
    document.querySelector('.terminal-new').click();
  })()`);
  await wait("!!document.querySelector('.bubble:not([hidden]) .xterm-screen')");

  if (action === "Escape") await browser("press", "Escape");
  else await read(`document.querySelector('.bubble:not([hidden]) [aria-label="${action === "close" ? "Close" : "Minimise"}"]').click()`);
  await wait("!document.querySelector('.bubble:not([hidden])')");
  await read("window.__releaseFonts()");
  expect(await read("window.__fake.app.calls.filter(call => call.method === 'terminal.open')")).toEqual([]);
  expect(await read("!!document.querySelector('[role=alert]')")).toBe(false);
}, 60_000);

// U4590's opt-in policy observer; the single startup guard above remains the CI guard.
for (const renderer of ["dom", "webgl"]) for (const seed of ["agents-10", "tree-40", "bubbles"]) for (const base of process.env.U500_BASE_ROOT ? [true, false] : [false]) {
  it.skipIf(!captureDir("U4590"))(`u4590_rendered_lifecycle_${renderer}_${seed}_${base ? "base" : "head"}`, async () => {
      const scale = process.env.U4590_SCALE === "2" ? 2 : 1;
      // Chromium's device-pixel ResizeObserver uses the physical scale even with an emulated DPR.
      // Match both at launch so xterm's canvas and viewport use the same device pixels.
      await browser("close");
      await browser("--args", `--force-device-scale-factor=${scale}`, "open", url("/src/ui/u498.html", base));
      await read("localStorage.clear(); sessionStorage.clear()");

      await load(seed, base, renderer, scale);
      let id = seed === "agents-10" ? "t-agent-3" : seed === "tree-40" ? "t-payments" : "t-runner";
      await select(seed === "agents-10" ? "agent-3" : seed === "tree-40" ? "payments" : "runner", id);
      const dir = join(captureDir("U4590")!, base ? "base" : "head");
      mkdirSync(dir, { recursive: true });
      const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", cwd: base ? process.env.U500_BASE_ROOT : process.cwd() }).trim();

      const capture = async (step: string) => {
        const marker = `U4590 ${step} later output`;
        await read(`(async () => { await window.__terminals.get('${id}').ready; await document.fonts.ready;
          window.__drawer = await import('/src/drawer/sliding.ts'); window.__shelf = await import('/src/shelf/sliding.ts'); })()`);
        await wait("!window.__drawer.drawerSliding() && !window.__shelf.shelfSliding()");
        // Pane and Bubble schedule their completed-layout refit on the next render frame.
        await read("new Promise(resolve => requestAnimationFrame(resolve))");
        await read(`(() => {
          const emulator = window.__terminals.get('${id}');
          window.__observedEmulator ??= emulator;
          const rows = emulator.serialize().rows;
          window.__fake.writeOutput('${id}', '\\x1b[2J\\x1b[HReady to continue?\\r\\n1. Continue\\r\\n2. Review changes\\r\\n3. Stop\\r\\nNext: choose an answer\\r\\nInput: unfinished work\\r\\nStatus: waiting for you\\r\\n');
          window.__fake.writeOutput('${id}', '\\x1b[9;1H' + ${JSON.stringify(marker)} + '\\x1b[' + rows + ';1H[Enter] Answer  [Esc] Stop');
        })()`);
        await wait(`window.__terminals.get('${id}').serialize().data.includes(${JSON.stringify(marker)})`);

        if (renderer === "dom") await wait(`[...document.querySelectorAll('.xterm-rows')].some(rows => rows.checkVisibility() && rows.textContent.includes(${JSON.stringify(marker)}))`);
        // emulator.ts schedules xterm painting after the subscription's parse callback.
        await read("new Promise(resolve => requestAnimationFrame(resolve))");

        const pixels = await read(`new Promise(resolve => {
          const canvas = document.querySelector('.bubble[data-bubble="${id}"]:not([hidden]) .xterm-screen canvas:not(.xterm-link-layer)')
            ?? document.querySelector('.pane-screen .xterm-screen canvas:not(.xterm-link-layer)');
          if (!canvas) { resolve(null); return; }
          const observer = new ResizeObserver(([entry]) => {
            observer.disconnect();
            resolve({ canvas: { width: canvas.width, height: canvas.height },
              css: entry.contentRect.toJSON(), device: entry.devicePixelContentBoxSize?.[0]?.toJSON?.()
                ?? { inlineSize: entry.devicePixelContentBoxSize?.[0]?.inlineSize, blockSize: entry.devicePixelContentBoxSize?.[0]?.blockSize } });
          });
          observer.observe(canvas, { box: 'device-pixel-content-box' });
        })`);

        const record = await read(`(() => {
          const emulator = window.__terminals.get('${id}');
          const bubble = document.querySelector('.bubble[data-bubble="${id}"]:not([hidden]) .bubble-body');
          const host = bubble ?? document.querySelector('.pane-screen');
          const snapshot = emulator.serialize();
          return { id: '${id}', dpr: devicePixelRatio, fontStatus: document.fonts.status, snapshot,
            sameEmulator: emulator === window.__observedEmulator,
            renderer: host?.querySelector('.xterm-screen canvas') ? 'webgl' : 'dom',
            host: host?.getBoundingClientRect().toJSON(),
            visibleRows: host?.querySelector('.xterm-rows')?.textContent,
            calls: window.__fake.app.calls.filter(c => ['terminal.resize', 'terminal.snapshot', 'terminal.catchUp', 'terminal.open', 'agent.spawn', 'rail.startDoor', 'terminal.write'].includes(c.method)) };
        })()`);

        const name = `${seed}-${renderer}-${step}${scale === 2 ? "-scale2" : ""}`;
        writeFileSync(join(dir, `${name}.trace.json`), JSON.stringify({ commit, seed, step, requestedRenderer: renderer, physicalScale: scale, pixels, record }, null, 2));
        writeFileSync(join(dir, `${name}.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
        await browser("screenshot", join(dir, `${name}.png`));
      };

      await capture("existing");

      if (seed === "agents-10") {
        await read("(async () => { window.__settings = await import('/src/settings/preferences.ts'); window.__settings.saveAppSettings({fontFamily:'monospace',fontSize:15}); })()");
        await wait(`window.__fake.app.calls.some(c=>c.method==='terminal.resize' && c.params.id==='${id}') && document.fonts.status==='loaded'`);
        await capture("custom-font");
        await read("window.__settings.saveAppSettings({fontFamily:'',fontSize:11})");
        await wait("document.fonts.status==='loaded'");
        await capture("bundled-font");
        await read(`window.__terminals.get('${id}').focus(); window.__fake.app.calls.length=0`);
        await browser("press", "Meta+=");
        await wait(`window.__fake.app.calls.some(c=>c.method==='terminal.resize' && c.params.id==='${id}')`);
        await capture("project-zoom");
        await browser("set", "viewport", "1412", "850", String(scale));
        await wait("innerWidth===1412 && innerHeight===850");
        await browser("set", "viewport", "1512", "950", String(scale));
        await wait("innerWidth===1512 && innerHeight===950");
        await capture("window-resize");
        await select("agent-4", "t-agent-4");
        await select("agent-3", "t-agent-3");
        await capture("restore-after-switch");
        await browser("click", '.rail-actions [aria-label="New Agent"]');
        await wait("window.__fake.app.calls.some(c=>c.method==='agent.spawn') && !!document.querySelector('.pane .xterm-screen')");
        id = await read<string>("[...window.__terminals.keys()].at(-1)");
        await read("window.__observedEmulator=null");
        await capture("new-agent");
      } else if (seed === "tree-40") {
        await read("document.querySelector('.shelf [aria-label=\"Close the Bench\"]').click()");
        await wait("document.querySelector('.window')?.dataset.shelf==='closed'");
        await capture("shelf-closed");
        await browser("press", "Meta+k");
        await browser("press", "b");
        await wait("!!document.querySelector('.shelf')");
        await capture("shelf-open");
        await browser("click", "#shelf-tab-pads");
        await wait("[...document.querySelectorAll('.pad-name')].some(e=>e.checkVisibility())");
        await read("[...document.querySelectorAll('.pad-name')].find(e=>e.checkVisibility()).focus()");
        await browser("press", "Enter");
        await wait("!!document.querySelector('.drawer[data-open=true]')");
        await capture("drawer-open");
        await browser("click", '.drawer[data-open=true] [aria-label=Close]');
        await wait("!document.querySelector('.drawer[data-open=true]')");
        await capture("drawer-closed");
        await read(`window.__fake.app.handlers['terminal.resize']=window.__fake.app.handlers['terminal.write']=()=>{throw new Error('Output unavailable. Retry.');}; window.__terminals.get('${id}').paste('retry')`);
        await wait("!!document.querySelector('.pane-failure')");
        await capture("dense-failure");
      } else {
        await browser("click", ".terminal-new");
        await wait("!!document.querySelector('.bubble:not([hidden]) .xterm-screen') && window.__fake.app.calls.some(c=>c.method==='terminal.open')");
        id = await read<string>("document.querySelector('.bubble:not([hidden])').dataset.bubble");
        await read("window.__observedEmulator=null");
        await capture("shell");
        await browser("dblclick", ".bubble:not([hidden]) .bubble-header");
        await capture("maximise");
        await browser("click", '.bubble:not([hidden]) [aria-label=Minimise]');
        await wait("!document.querySelector('.bubble:not([hidden])')");
        await read(`document.querySelector('button.terminal-tab[data-bubble="${id}"]')?.click()`);
        await wait("!!document.querySelector('.bubble:not([hidden]) .xterm-screen')");
        await capture("reopen");
        await browser("dblclick", ".bubble:not([hidden]) .bubble-header");
        const header = await read<{ x: number; y: number }>("(() => { const box = document.querySelector('.bubble:not([hidden]) .bubble-header').getBoundingClientRect(); return {x:box.x+box.width/2,y:box.y+box.height/2}; })()");
        await browser("mouse", "move", String(header.x), String(header.y));
        await browser("mouse", "down");
        await browser("mouse", "move", String(header.x + 40), String(header.y + 30));
        await browser("mouse", "up");
        await capture("move");
        await read(`window.__terminals.get('${id}').focus()`);
        await browser("press", "Meta+b");
        await wait("!document.querySelector('.bubble:not([hidden])') && !!document.activeElement?.closest('.pane-screen')");
        await browser("press", "Meta+b");
        await wait("!!document.activeElement?.closest('.bubble:not([hidden])')");
        await capture("pair-switch");
        await browser("click", '.rail-row[data-id=runner]');
        await wait("!document.querySelector('.bubble:not([hidden])')");
        await browser("press", "Meta+t");
        await wait("!!document.querySelector('.bubble:not([hidden]) .xterm-screen')");
        id = await read<string>("document.querySelector('.bubble:not([hidden])').dataset.bubble");
        await read("window.__observedEmulator=null");
        await capture("quick-terminal");
      }
  }, 120_000);
}

it("u4818_webgl_scale2_paints_output_after_resize", async () => {
  // Chromium's device-pixel ResizeObserver uses the physical scale even with an emulated DPR.
  await browser("close");
  await browser("--args", "--force-device-scale-factor=2", "open", url("/src/ui/u498.html"));
  await read("localStorage.clear(); sessionStorage.clear()");
  await load("agents-10", false, "webgl", 2);
  // Keep the drawing buffer so the canvas's pixels can be read after xterm's frame.
  await read(`(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, options) {
      return getContext.call(this, type, type === 'webgl2' ? { ...options, preserveDrawingBuffer: true } : options);
    };
  })()`);
  await select("agent-3", "t-agent-3");
  await read(`(() => {
    const rows = window.__terminals.get('t-agent-3').serialize().rows;
    window.__fake.writeOutput('t-agent-3', '\\x1b[2J\\x1b[HReady to continue?\\r\\n1. Continue\\r\\n2. Review changes\\r\\n3. Stop\\r\\n');
    window.__fake.writeOutput('t-agent-3', '\\x1b[9;1HU4818 marker\\x1b[' + rows + ';1H[Enter] Answer  [Esc] Stop');
  })()`);
  await wait("window.__terminals.get('t-agent-3').serialize().data.includes('U4818 marker')");

  // Rows 1 to 4, the marker row and the bottom key bar must each hold painted pixels.
  const painted = await read<number[]>(`new Promise(resolve => requestAnimationFrame(() => {
    const canvas = document.querySelector('.pane-screen .xterm-screen canvas:not(.xterm-link-layer)');
    const rows = window.__terminals.get('t-agent-3').serialize().rows;
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    const context = copy.getContext('2d');
    context.drawImage(canvas, 0, 0);
    const cell = canvas.height / rows;
    resolve([0, 1, 2, 3, 8, rows - 1].map(row => {
      const data = context.getImageData(0, Math.floor(row * cell), canvas.width, Math.floor(cell)).data;
      const first = [data[0], data[1], data[2]];
      let count = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] !== first[0] || data[i + 1] !== first[1] || data[i + 2] !== first[2]) count++;
      return count;
    }));
  }))`);

  expect(painted.every(count => count > 0), `painted pixels per row: ${painted}`).toBe(true);
}, 120_000);
