import * as xtermModule from "@xterm/xterm";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { FitAddon } from "@xterm/addon-fit";
import { afterEach, expect, it, vi } from "vitest";
import { createXtermEmulators } from "./emulator";
import { DEFAULT_FONT_SIZE, fontSizeStorage } from "./fontSize";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

it("u102_another_project_does_not_read_the_saved_size", async () => {
  await fontSizeStorage("/one").write(18);
  expect(fontSizeStorage("/two").read()).toBeNull();
  expect(fontSizeStorage("/one").read()).toBe(18);
});

it("u102_unreadable_storage_is_absent", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  expect(fontSizeStorage("/p").read()).toBeNull();
});

it.each([[100, 93, 60], [93, 100, 90], [93, 100, 91], [101, 94, -1], [51, 47, -1]])("u102_rewrap_%s_to_%s_keeps_logical_line_at_row_%s", async (beforeCols, afterCols, row) => {
  const spy = vi.spyOn(xtermModule, "Terminal");

  const emulator = createXtermEmulators(undefined, () => ({
    activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; },
  }))("t-a");

  const terminal = spy.mock.instances[0];

  if (!terminal) throw new Error("xterm was not created");
  spy.mockRestore();
  terminal.resize(beforeCols, 24);
  const lines = Array.from({ length: 100 }, (_, index) => `${String(index).padStart(3, "0")} ${"x".repeat(190)}`).join("\r\n");
  await new Promise<void>((resolve) => emulator.write(new TextEncoder().encode(lines), resolve));

  if (row >= 0) terminal.scrollToLine(row);

  const top = () => {
    const buffer = terminal.buffer.active;
    let line = buffer.viewportY;

    while (line > 0 && buffer.getLine(line)?.isWrapped) line -= 1;

    return buffer.getLine(line)?.translateToString(true);
  };

  const content = () => {
    const buffer = terminal.buffer.active;
    const lines: string[] = [];

    for (let index = 0; index < buffer.length; index += 1) {
      const line = buffer.getLine(index)!;
      const text = line.translateToString(true);

      if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
      else lines.push(text);
    }

    return lines;
  };

  const before = content();
  expect(before.at(-1)).toHaveLength(194);

  if (row >= 0) expect(top()).toMatch(/^030 /);
  else expect(emulator.isAtBottom()).toBe(true);
  const fitPolicies: (boolean | undefined)[] = [];

  const fit = vi.spyOn(FitAddon.prototype, "fit").mockImplementation(() => {
    fitPolicies.push(terminal.options.reflowCursorLine);
    terminal.resize(afterCols, 24);
  });

  emulator.setFontSize(DEFAULT_FONT_SIZE + 1);
  emulator.fit();

  if (row >= 0) expect(top()).toMatch(/^030 /);
  else expect(emulator.isAtBottom()).toBe(true);
  expect(content()).toEqual(before);
  fit.mockImplementation(() => {
    fitPolicies.push(terminal.options.reflowCursorLine);
    terminal.resize(beforeCols, 24);
  });
  emulator.setFontSize(DEFAULT_FONT_SIZE);
  emulator.fit();
  expect(content()).toEqual(before);

  if (row >= 0) expect(top()).toMatch(/^030 /);
  else expect(emulator.isAtBottom()).toBe(true);
  emulator.fit();
  expect(fitPolicies).toEqual([true, true, false]);
  expect(terminal.options.reflowCursorLine).toBe(false);
  emulator.dispose();
});

it("u102_a_second_chord_before_restoration_keeps_the_reflow_anchor", async () => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
  const spy = vi.spyOn(xtermModule, "Terminal");

  const emulator = createXtermEmulators(undefined, () => ({
    activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; },
  }))("t-a");

  const terminal = spy.mock.instances[0];

  if (!terminal) throw new Error("xterm was not created");
  spy.mockRestore();
  vi.spyOn(terminal, "open").mockImplementation(() => {});
  vi.spyOn(terminal, "element", "get").mockReturnValue(document.createElement("div"));
  // This buffer-only probe closes drawing; the addon requires an opened renderer.
  vi.spyOn(LigaturesAddon.prototype, "activate").mockImplementation(() => {});
  vi.spyOn(terminal, "registerCharacterJoiner").mockReturnValue(0);
  vi.spyOn(terminal, "focus").mockImplementation(() => {});
  let cols = 100;
  vi.spyOn(FitAddon.prototype, "fit").mockImplementation(() => terminal.resize(cols, 24));
  emulator.show(document.createElement("div"));
  const lines = Array.from({ length: 100 }, (_, index) => `${String(index).padStart(3, "0")} ${"x".repeat(180)}`).join("\r\n");
  await new Promise<void>((resolve) => emulator.write(new TextEncoder().encode(lines), resolve));
  terminal.scrollToLine(60);
  emulator.setFontSize(DEFAULT_FONT_SIZE + 1);
  cols = 93;
  emulator.fit();
  emulator.setFontSize(DEFAULT_FONT_SIZE + 2);
  cols = 87;
  requestAnimationFrame(() => emulator.fit());
  vi.advanceTimersToNextFrame();
  vi.advanceTimersToNextFrame();
  const buffer = terminal.buffer.active;
  expect(buffer.getLine(buffer.viewportY)?.translateToString(true)).toMatch(/^030 /);
  expect(terminal.markers).toHaveLength(0);
  emulator.dispose();
});

it("z3788a_osc52_copies_once_and_reports_failure", async () => {
  const { connectFakeProject, callsTo } = await import("./paneHarness");
  const { terminal, info } = await import("../testing/nodes");
  const { createScreens } = await import("./screens");
  const { lazyXtermEmulators } = await import("./lazyEmulator");
  const { app, connected } = await connectFakeProject([terminal("a"), terminal("b")], [info("t-a"), info("t-b")]);
  const screens = createScreens(connected, lazyXtermEmulators());
  const emulator = screens.emulatorFor("t-a");
  await emulator.ready;
  const output = () => new Promise<void>(resolve => emulator.write(new TextEncoder().encode("\x1b]52;c;Y2Fmw6kg5LiW55WM\x07after"), resolve));
  await output();
  expect(app.clipboardWrites).toEqual(["café 世界"]);
  app.clipboardWrite = async () => { throw new Error("pasteboard unavailable"); };

  await output();
  expect(screens.failure("t-a")).toContain("pasteboard unavailable");
  expect(screens.failure("t-b")).toBeNull();
  app.clipboardWrite = async text => { app.clipboardWrites.push(text); };

  await output();
  expect(app.clipboardWrites).toEqual(["café 世界", "café 世界"]);
  expect(screens.failure("t-a")).toBeNull();
  expect(callsTo(app, "terminal.write")).toEqual([]);
  screens.dispose();
  connected.stopTerminalScheme();
});

it("z3788a_osc52_query_does_not_read_clipboard", async () => {
  const readText = vi.fn(async () => "private clipboard");
  vi.stubGlobal("navigator", { clipboard: { readText } });
  const emulator = createXtermEmulators()("t-a");
  const input: string[] = [];
  emulator.onInput(bytes => input.push(new TextDecoder().decode(bytes)));
  await new Promise<void>(resolve => emulator.write(new TextEncoder().encode("\x1b]52;c;?\x07"), resolve));
  expect(readText).not.toHaveBeenCalled();
  expect(input.join("")).toBe("\x1b]52;c;\x07");
  emulator.dispose();
});

it("z3788a_images_keep_output_and_input_usable", async () => {
  const { openLane } = await import("../todos/laneBrowser");
  const { captureDir } = await import("../testing/captures");
  const { mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = captureDir("Z3788a");
  const page = await openLane(1512, "dark", "z3788a-images");

  try {
    const base = await page.evaluate<string>("location.origin");

    if (dir) {
      mkdirSync(dir, { recursive: true });
      await page.browser("record", "start", join(dir, "images.webm"));
      await page.browser("set", "media", "dark");
    }

    for (const renderer of ["dom", "webgl"]) {
      await page.browser("open", `${base}/harness.html?seed=tree-40&view=workstreams&items=1&tabs=1&renderer=${renderer}`);
      await page.until("!!document.querySelector('.rail-row[data-id=migrate]')");
      await page.browser("focus", '.rail-row[data-id="migrate"]');
      await page.browser("press", "Enter");
      await page.until("!!document.querySelector('.pane-screen .xterm-helper-textarea')");
      await page.evaluate(`(async () => {
        const emulator = window.__terminals.get('t-migrate');
        window.__fake.app.calls.length = 0;
        const write = text => new Promise(resolve => emulator.write(new TextEncoder().encode(text), resolve));
        await write('\\x1bc');
        await write('\\x1bPq"1;1;120;60#1;2;100;0;0#1!120~-!120~-!120~-!120~-!120~-!120~-!120~-!120~-!120~-!120~\\x1b\\\\');
        await write('\\x1b[6n');
        return true;
      })()`);
      // Cursor reports prove the parser consumed image rows, rather than silently dropping the sequence.
      const reports = await page.evaluate<string[]>("window.__fake.app.calls.filter(call => call.method === 'terminal.write').map(call => atob(call.params.data))");
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatch(/^\x1b\[\d+;\d+R$/);
      expect(reports[0]).not.toBe("\x1b[1;1R");
      await page.evaluate(`(async () => {
        const emulator = window.__terminals.get('t-migrate');
        const canvas = document.createElement('canvas');
        canvas.width = 120; canvas.height = 60;
        const context = canvas.getContext('2d');
        context.fillStyle = '#55cc88'; context.fillRect(0, 0, 120, 60);
        const png = canvas.toDataURL('image/png').split(',')[1];
        window.__fake.app.calls.length = 0;
        window.__imageOutput = '\\x1bc\\x1b]1337;File=inline=1;size=' + atob(png).length + ':' + png + '\\x07\\x1b[6n\\r\\n\\x1b]133;A\\x07Images complete\\x1b]133;D;0\\x07';
        await new Promise(resolve => emulator.write(new TextEncoder().encode(window.__imageOutput), resolve));
        emulator.selectTurn(0, false);
        return true;
      })()`);
      const copied = await page.evaluate<string>("window.__terminals.get('t-migrate').selection()");
      expect(copied).toContain("Images complete");
      const afterImage = await page.evaluate<string[]>("window.__fake.app.calls.filter(call => call.method === 'terminal.write').map(call => atob(call.params.data))");
      expect(afterImage).toHaveLength(1);
      expect(afterImage[0]).not.toBe("\x1b[1;1R");
      await page.resetCalls();
      await page.browser("focus", ".pane-screen .xterm-helper-textarea");
      await page.browser("press", "a");
      await page.until("window.__fake.app.calls.some(call => call.method === 'terminal.write')");
      expect(await page.evaluate("window.__fake.app.calls.filter(call => call.method === 'terminal.write').map(call => [call.params.id, atob(call.params.data)])")).toEqual([["t-migrate", "a"]]);
      // Keep the fixture's authoritative snapshot in step with the parser probe before navigation.
      await page.evaluate("(() => { window.__fake.writeOutput('t-migrate', window.__imageOutput); return true; })()");
      await page.browser("focus", '.rail-row[data-id="tokens"]');
      await page.browser("press", "Enter");
      await page.until("window.__terminals.has('t-tokens')");
      await page.browser("focus", '.rail-row[data-id="migrate"]');
      await page.browser("press", "Enter");
      await page.until("document.querySelector('.rail-row[data-id=migrate]')?.dataset.selected === 'true'");
      await page.browser("set", "viewport", "1400", "900");
      await page.browser("set", "viewport", "1512", "950");
      await page.until("(() => { const e = window.__terminals.get('t-migrate'); e.selectTurn(0, false); return e.selection().includes('Images complete'); })()");
      expect(await page.evaluate("window.__terminals.get('t-migrate').selection()")).toContain("Images complete");
      await page.capture("Z3788a", `images-${renderer}`);
    }
  } finally {
    try {
      if (dir) await page.browser("record", "stop");
    } finally {
      await page.close();
    }
  }
}, 60_000);

it("z3788a_search_navigates_scrollback_without_input", async () => {
  const spy = vi.spyOn(xtermModule, "Terminal");
  const emulator = createXtermEmulators(undefined, () => ({ activate() {}, dispose() {}, onContextLoss() { return { dispose() {} }; } }))("t-find");
  const terminal = spy.mock.instances[0]!;
  spy.mockRestore();
  const host = document.body.appendChild(document.createElement("div"));
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  emulator.show(host);
  const lines = Array.from({ length: 100 }, (_, index) => index === 3 || index === 60 ? `needle ${index}` : `line ${index}`).join("\r\n");
  await new Promise<void>((resolve) => emulator.write(new TextEncoder().encode(lines), resolve));
  const written = vi.spyOn(terminal, "write");
  const at = () => terminal.buffer.active.getLine(terminal.getSelectionPosition()!.start.y)!.translateToString(true);

  expect(emulator.find!("needle")).toBe(true);
  expect(at()).toBe("needle 3");
  expect(emulator.find!("needle")).toBe(true);
  expect(at()).toBe("needle 60");
  expect(emulator.find!("needle", true)).toBe(true);
  expect(at()).toBe("needle 3");
  expect(emulator.find!("absent")).toBe(false);
  expect(emulator.find!("")).toBe(false);
  expect(written).not.toHaveBeenCalled();
  emulator.dispose();
  host.remove();
});
